export type ControlType = 'button' | 'toggle' | 'slider' | 'folder' | 'status';

export interface DeckAction {
  id: string;
  providerId: string;
  type: string;
  enabled: boolean;
  parameters: Record<string, unknown>;
  delayMs: number;
  repeat: number;
  condition: Record<string, unknown> | null;
  continueOnError: boolean;
}

export interface DeckControl {
  id: string;
  type: ControlType;
  label: string;
  enabled: boolean;
  column: number;
  row: number;
  columnSpan: number;
  rowSpan: number;
  icon: { kind: 'builtin'; name: string } | { kind: 'asset'; hash: string; mimeType?: string } | null;
  background: string;
  foreground: string;
  stateBinding: string | null;
  actions: DeckAction[];
  actionsB?: DeckAction[];
  minimum?: number;
  maximum?: number;
  step?: number;
  targetPageId?: string;
}

export interface DeckPage {
  id: string;
  name: string;
  columns: number;
  background: string;
  backgroundAsset: string | null;
  parentPageId: string | null;
  controls: DeckControl[];
}

export interface Deck {
  id: string;
  name: string;
  enabled: boolean;
  defaultPageId: string;
  autoSwitchEnabled: boolean;
  applicationRules: Array<Record<string, unknown>>;
  pages: DeckPage[];
}

export interface DeckDocument {
  schemaVersion: number;
  revision: number;
  stateRevision: number;
  activeDeckId: string;
  activePageId: string;
  autoSwitchEnabled: boolean;
  variables: Record<string, unknown>;
  controlStates: Record<string, unknown>;
  decks: Deck[];
}

export interface ProviderDescription {
  id: string;
  name: string;
  available: boolean;
  actions: ProviderActionDescription[];
}

export type ActionInputType = 'trigger' | 'toggle' | 'number';

export interface ProviderActionDescription {
  type: string;
  name: string;
  supportedControlTypes: ControlType[];
  inputType: ActionInputType;
  developerOnly?: boolean;
}
