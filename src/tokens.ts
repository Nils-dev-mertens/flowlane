export const TOKENS = {
  ConfigService: Symbol.for('IConfigService'),
  TicketService: Symbol.for('ITicketService'),
  GitService:    Symbol.for('IGitService'),
  PRService:     Symbol.for('IPRService'),
} as const;
