import type { Ticket } from '../../types';

export interface ITicketService {
  /** Fetch a single ticket by ID. */
  getTicket(id: string): Promise<Ticket>;
  /** Fetch open tickets assigned to the given user identity. */
  getTicketsForUser(user: string): Promise<Ticket[]>;
  /** Transition a ticket to a new state, optionally also setting the board column. */
  updateStatus(id: string, state: string, boardColumn?: string): Promise<void>;
}
