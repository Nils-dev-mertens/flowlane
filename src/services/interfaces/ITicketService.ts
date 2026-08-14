import type { CreateTicketParams, Ticket } from '../../types';

export interface ITicketService {
  /** Fetch a single ticket by ID. */
  getTicket(id: string): Promise<Ticket>;
  /** Fetch open tickets assigned to the given user identity. */
  getTicketsForUser(user: string): Promise<Ticket[]>;
  /** Transition a ticket to a new state, optionally also setting the board column. */
  updateStatus(id: string, state: string, boardColumn?: string): Promise<void>;
  /**
   * Create a ticket/work item. Providers map `kind` and optional fields to
   * their own capabilities and must throw a clear error for unsupported
   * fields rather than silently dropping them.
   */
  createTicket(params: CreateTicketParams): Promise<Ticket>;
}
