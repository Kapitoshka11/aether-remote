use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use serde_json::json;
use socket2::{Domain, Protocol, Socket, Type};
use tokio::net::UdpSocket;
use tokio::sync::oneshot;

use crate::storage;
use crate::win_system;

#[derive(Clone)]
pub struct DiscoveryIdentity {
    pub hostname: String,
    pub mac: String,
    pub port: u16,
    pub tls_fingerprint: String,
    pub primary_ip: String,
    pub broadcast_targets: Vec<Ipv4Addr>,
}

pub fn should_reply_to_udp_probe(bytes: &[u8]) -> bool {
    let trimmed = bytes.trim_ascii();
    !trimmed.is_empty() && trimmed.starts_with(b"AETHER_DISCOVER")
}

pub fn spawn_discovery_services(
    identity: Arc<RwLock<DiscoveryIdentity>>,
) -> oneshot::Sender<()> {
    let (tx, _bound_port) = spawn_discovery_services_internal(identity, 8081, 8081, true, true);
    tx
}

#[cfg(test)]
pub fn spawn_discovery_services_for_test(
    identity: Arc<RwLock<DiscoveryIdentity>>,
    bind_port: u16,
    beacon_target_port: u16,
) -> (oneshot::Sender<()>, Option<u16>) {
    spawn_discovery_services_internal(identity, bind_port, beacon_target_port, false, false)
}

fn spawn_discovery_services_internal(
    identity: Arc<RwLock<DiscoveryIdentity>>,
    bind_port: u16,
    beacon_target_port: u16,
    allow_ephemeral_fallback: bool,
    enable_mdns: bool,
) -> (oneshot::Sender<()>, Option<u16>) {
    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();

    let udp_socket = bind_discovery_udp(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, bind_port), true)
        .or_else(|| {
            if allow_ephemeral_fallback && bind_port != 0 {
                bind_discovery_udp(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0), true)
            } else {
                None
            }
        });
    let bound_port = udp_socket
        .as_ref()
        .and_then(|s| s.local_addr().ok())
        .map(|a| a.port());
    let mdns_socket = if enable_mdns {
        bind_mdns_socket()
    } else {
        None
    };

    tokio::spawn(async move {
        let Some(udp_sock) = udp_socket else {
            return;
        };

        let mut beacon_interval = tokio::time::interval(Duration::from_secs(2));
        beacon_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        let mut udp_buf = [0u8; 512];
        let mut mdns_buf = [0u8; 1500];

        loop {
            tokio::select! {
                _ = &mut shutdown_rx => break,
                _ = beacon_interval.tick() => {
                    if beacon_target_port == 0 {
                        continue;
                    }
                    let id = identity.read().map(|g| g.clone()).ok();
                    if let Some(id) = id {
                        let payload = beacon_json_bytes(&id);
                        for target in &id.broadcast_targets {
                            let dest = SocketAddr::V4(SocketAddrV4::new(*target, beacon_target_port));
                            let _ = udp_sock.send_to(&payload, dest).await;
                        }
                    }
                }
                recv = udp_sock.recv_from(&mut udp_buf) => {
                    if let Ok((len, peer)) = recv
                        && len > 0
                        && should_reply_to_udp_probe(&udp_buf[..len])
                    {
                        let snapshot = identity.read().ok().map(|g| g.clone());
                        if let Some(id) = snapshot {
                            let payload = beacon_json_bytes(&id);
                            let _ = udp_sock.send_to(&payload, peer).await;
                        }
                    }
                }
                recv_mdns = async {
                    match &mdns_socket {
                        Some(s) => s.recv_from(&mut mdns_buf).await,
                        None => std::future::pending().await,
                    }
                } => {
                    if let (Ok((len, _peer)), Some(sock)) = (recv_mdns, &mdns_socket) {
                        let questions = parse_dns_questions(&mdns_buf[..len]);
                        let wants_service = questions.iter().any(|q| q.contains("_aether-remote._tcp.local"));
                        let wants_enum = questions.iter().any(|q| q.contains("_services._dns-sd._udp.local"));
                        if (wants_service || wants_enum)
                            && let Some(id) = identity.read().ok().map(|g| g.clone())
                            && let Ok(ip_v4) = id.primary_ip.parse::<Ipv4Addr>()
                        {
                            let response = build_mdns_response(&id.hostname, ip_v4, id.port, &id.tls_fingerprint, wants_enum);
                            let mcast_dest = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::new(224, 0, 0, 251), 5353));
                            let _ = sock.send_to(&response, mcast_dest).await;
                        }
                    }
                }
            }
        }
    });

    (shutdown_tx, bound_port)
}

pub fn send_wol_magic_packet(mac: &str) -> Result<(), String> {
    let (formatted, _) = storage::normalize_mac_and_id(mac)?;
    let bytes: Vec<u8> = formatted
        .split(':')
        .filter_map(|part| u8::from_str_radix(part, 16).ok())
        .collect();
    if bytes.len() != 6 {
        return Err("Invalid MAC address".to_owned());
    }
    let mut packet = Vec::with_capacity(102);
    packet.extend_from_slice(&[0xff_u8; 6]);
    for _ in 0..16 {
        packet.extend_from_slice(&bytes);
    }

    let std_sock = std::net::UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    std_sock.set_broadcast(true).map_err(|e| e.to_string())?;
    let targets = win_system::detect_network_endpoints("localhost").broadcast_targets;
    for bcast in targets {
        let _ = std_sock.send_to(&packet, SocketAddrV4::new(bcast, 9));
        let _ = std_sock.send_to(&packet, SocketAddrV4::new(bcast, 7));
    }
    Ok(())
}

fn beacon_json_bytes(id: &DiscoveryIdentity) -> Vec<u8> {
    json!({
        "service": "aether-remote",
        "ip": id.primary_ip,
        "port": id.port,
        "host": id.hostname,
        "mac": id.mac,
        "protocolVersion": "2.0",
        "secure": true,
        "tlsFingerprint": id.tls_fingerprint
    })
    .to_string()
    .into_bytes()
}

fn bind_discovery_udp(addr: SocketAddrV4, broadcast: bool) -> Option<UdpSocket> {
    let sock = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP)).ok()?;
    let _ = sock.set_broadcast(broadcast);
    let _ = sock.set_nonblocking(true);
    sock.bind(&addr.into()).ok()?;
    let std_udp: std::net::UdpSocket = sock.into();
    UdpSocket::from_std(std_udp).ok()
}

fn bind_mdns_socket() -> Option<UdpSocket> {
    let sock = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP)).ok()?;
    let _ = sock.set_reuse_address(true);
    let _ = sock.set_multicast_loop_v4(true);
    let _ = sock.set_nonblocking(true);
    sock.bind(&SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 5353).into()).ok()?;
    let mcast = Ipv4Addr::new(224, 0, 0, 251);
    let mut joined_any = false;
    if let Ok(ifas) = local_ip_address::list_afinet_netifas() {
        for (_name, ip) in ifas {
            if let std::net::IpAddr::V4(v4) = ip
                && !v4.is_loopback()
                && sock.join_multicast_v4(&mcast, &v4).is_ok()
            {
                joined_any = true;
            }
        }
    }
    if !joined_any {
        let _ = sock.join_multicast_v4(&mcast, &Ipv4Addr::UNSPECIFIED);
    }
    let std_udp: std::net::UdpSocket = sock.into();
    UdpSocket::from_std(std_udp).ok()
}

fn parse_dns_questions(packet: &[u8]) -> Vec<String> {
    if packet.len() < 14 || (packet[2] & 0x80) != 0 {
        return Vec::new();
    }
    let qdcount = u16::from_be_bytes([packet[4], packet[5]]) as usize;
    let mut pos = 12_usize;
    let mut questions = Vec::new();
    for _ in 0..qdcount.min(16) {
        let mut labels = Vec::new();
        let mut jumped = false;
        let mut cursor = pos;
        let mut end_pos = pos;
        let mut hops = 0;
        loop {
            if cursor >= packet.len() || hops > 32 {
                return questions;
            }
            let len = packet[cursor] as usize;
            if len == 0 {
                if !jumped {
                    end_pos = cursor + 1;
                }
                break;
            }
            if (len & 0xC0) == 0xC0 {
                if cursor + 1 >= packet.len() {
                    return questions;
                }
                if !jumped {
                    end_pos = cursor + 2;
                }
                cursor = ((len & 0x3F) << 8) | (packet[cursor + 1] as usize);
                jumped = true;
                hops += 1;
                continue;
            }
            cursor += 1;
            if cursor + len > packet.len() {
                return questions;
            }
            labels.push(String::from_utf8_lossy(&packet[cursor..cursor + len]).to_ascii_lowercase());
            cursor += len;
            if !jumped {
                end_pos = cursor;
            }
        }
        if !labels.is_empty() {
            questions.push(labels.join("."));
        }
        pos = end_pos + 4;
        if pos > packet.len() {
            break;
        }
    }
    questions
}

fn encode_dns_name(buf: &mut Vec<u8>, name: &str) {
    for part in name.split('.').filter(|p| !p.is_empty()) {
        let bytes = part.as_bytes();
        let len = bytes.len().min(63);
        buf.push(len as u8);
        buf.extend_from_slice(&bytes[..len]);
    }
    buf.push(0);
}

fn build_mdns_response(
    hostname: &str,
    ip: Ipv4Addr,
    port: u16,
    fingerprint: &str,
    include_enum_ptr: bool,
) -> Vec<u8> {
    let mut pkt = Vec::with_capacity(512);
    let ancount: u16 = if include_enum_ptr { 5 } else { 4 };
    // Header: ID=0, Flags=0x8400 (Response + Authoritative), QDCOUNT=0, ANCOUNT, NSCOUNT=0, ARCOUNT=0
    pkt.extend_from_slice(&[0x00, 0x00, 0x84, 0x00, 0x00, 0x00]);
    pkt.extend_from_slice(&ancount.to_be_bytes());
    pkt.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]);

    let clean_host: String = hostname
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .take(40)
        .collect();
    let host_label = if clean_host.is_empty() { "AetherHost" } else { &clean_host };
    let service_instance = format!("Aether Remote Host - {host_label}._aether-remote._tcp.local");
    let host_local = format!("{host_label}.local");

    if include_enum_ptr {
        encode_dns_name(&mut pkt, "_services._dns-sd._udp.local");
        pkt.extend_from_slice(&[0x00, 12, 0x00, 0x01]);
        pkt.extend_from_slice(&120_u32.to_be_bytes());
        let mut rdata = Vec::new();
        encode_dns_name(&mut rdata, "_aether-remote._tcp.local");
        pkt.extend_from_slice(&(rdata.len() as u16).to_be_bytes());
        pkt.extend_from_slice(&rdata);
    }

    // 1. PTR _aether-remote._tcp.local -> instance
    encode_dns_name(&mut pkt, "_aether-remote._tcp.local");
    pkt.extend_from_slice(&[0x00, 12, 0x00, 0x01]);
    pkt.extend_from_slice(&120_u32.to_be_bytes());
    let mut rdata = Vec::new();
    encode_dns_name(&mut rdata, &service_instance);
    pkt.extend_from_slice(&(rdata.len() as u16).to_be_bytes());
    pkt.extend_from_slice(&rdata);

    // 2. SRV instance -> port + host_local
    encode_dns_name(&mut pkt, &service_instance);
    pkt.extend_from_slice(&[0x00, 33, 0x80, 0x01]);
    pkt.extend_from_slice(&120_u32.to_be_bytes());
    let mut srv_data = Vec::new();
    srv_data.extend_from_slice(&0_u16.to_be_bytes());
    srv_data.extend_from_slice(&0_u16.to_be_bytes());
    srv_data.extend_from_slice(&port.to_be_bytes());
    encode_dns_name(&mut srv_data, &host_local);
    pkt.extend_from_slice(&(srv_data.len() as u16).to_be_bytes());
    pkt.extend_from_slice(&srv_data);

    // 3. TXT instance -> hostname / secure / protocolVersion / tlsFingerprint
    encode_dns_name(&mut pkt, &service_instance);
    pkt.extend_from_slice(&[0x00, 16, 0x80, 0x01]);
    pkt.extend_from_slice(&120_u32.to_be_bytes());
    let mut txt_data = Vec::new();
    for entry in [
        format!("hostname={hostname}"),
        format!("host={hostname}"),
        "secure=true".to_owned(),
        "protocolVersion=2.0".to_owned(),
        format!("tlsFingerprint={fingerprint}"),
    ] {
        let b = entry.as_bytes();
        let l = b.len().min(255);
        txt_data.push(l as u8);
        txt_data.extend_from_slice(&b[..l]);
    }
    pkt.extend_from_slice(&(txt_data.len() as u16).to_be_bytes());
    pkt.extend_from_slice(&txt_data);

    // 4. A host_local -> IPv4
    encode_dns_name(&mut pkt, &host_local);
    pkt.extend_from_slice(&[0x00, 1, 0x80, 0x01]);
    pkt.extend_from_slice(&120_u32.to_be_bytes());
    pkt.extend_from_slice(&4_u16.to_be_bytes());
    pkt.extend_from_slice(&ip.octets());

    pkt
}

#[cfg(test)]
mod tests {
    use super::{
        DiscoveryIdentity, should_reply_to_udp_probe, spawn_discovery_services_for_test,
    };
    use std::net::Ipv4Addr;
    use std::sync::{Arc, RwLock};
    use std::time::Duration;

    #[test]
    fn probe_filter_accepts_only_discover_requests() {
        assert!(should_reply_to_udp_probe(b"AETHER_DISCOVER"));
        assert!(should_reply_to_udp_probe(b"  AETHER_DISCOVER\r\n"));
        assert!(!should_reply_to_udp_probe(
            br#"{"service":"aether-remote","ip":"192.168.1.5"}"#
        ));
        assert!(!should_reply_to_udp_probe(b""));
        assert!(!should_reply_to_udp_probe(b"HELLO"));
    }

    #[tokio::test]
    async fn udp_discovery_replies_to_probe_and_does_not_echo_beacons() {
        let identity = Arc::new(RwLock::new(DiscoveryIdentity {
            hostname: "TEST-PC".to_owned(),
            mac: "AA:BB:CC:DD:EE:FF".to_owned(),
            port: 18080,
            tls_fingerprint: "SHA256:00112233".to_owned(),
            primary_ip: "127.0.0.1".to_owned(),
            broadcast_targets: vec![Ipv4Addr::LOCALHOST],
        }));

        let (shutdown, port_opt) = spawn_discovery_services_for_test(identity, 0, 0);
        let server_port = port_opt.expect("bound ephemeral udp port");

        let client = tokio::net::UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let server_addr = format!("127.0.0.1:{server_port}");

        // Sending a JSON beacon back to the discovery socket must NOT cause an echo reply
        client
            .send_to(
                br#"{"service":"aether-remote","ip":"127.0.0.1"}"#,
                &server_addr,
            )
            .await
            .unwrap();
        let mut buf = [0u8; 512];
        let echo_res = tokio::time::timeout(
            Duration::from_millis(200),
            client.recv_from(&mut buf),
        )
        .await;
        assert!(echo_res.is_err(), "server must ignore beacon packets and not storm");

        // Sending AETHER_DISCOVER must yield a valid JSON beacon reply
        client.send_to(b"AETHER_DISCOVER", &server_addr).await.unwrap();
        let (len, _) = tokio::time::timeout(
            Duration::from_secs(2),
            client.recv_from(&mut buf),
        )
        .await
        .expect("probe reply within timeout")
        .expect("udp recv");
        let parsed: serde_json::Value = serde_json::from_slice(&buf[..len]).unwrap();
        assert_eq!(parsed["service"], "aether-remote");
        assert_eq!(parsed["port"], 18080);
        assert_eq!(parsed["tlsFingerprint"], "SHA256:00112233");

        let _ = shutdown.send(());
    }
}
