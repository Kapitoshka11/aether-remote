function createProviderRegistry() {
  const providers = new Map();

  function register(provider) {
    if (!provider || typeof provider.id !== 'string' || !provider.id) throw new Error('Provider must have an id');
    if (providers.has(provider.id)) throw new Error(`Provider already registered: ${provider.id}`);
    if (typeof provider.execute !== 'function') throw new Error(`Provider ${provider.id} must implement execute`);
    providers.set(provider.id, provider);
    return provider;
  }

  function get(providerId) {
    const provider = providers.get(providerId);
    if (!provider) throw new Error(`Action provider is unavailable: ${providerId}`);
    return provider;
  }

  function describe() {
    return Array.from(providers.values()).map(provider => ({
      id: provider.id,
      name: provider.name || provider.id,
      available: typeof provider.isAvailable === 'function' ? provider.isAvailable() : true,
      actions: Array.isArray(provider.actions) ? structuredClone(provider.actions) : []
    }));
  }

  function subscribe(publish) {
    const disposers = Array.from(providers.values())
      .filter(provider => typeof provider.subscribe === 'function')
      .map(provider => provider.subscribe(publish))
      .filter(disposer => typeof disposer === 'function');
    return () => disposers.forEach(dispose => dispose());
  }

  return { register, get, describe, subscribe };
}

module.exports = { createProviderRegistry };
