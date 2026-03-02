import type { Ticket } from '../../types';

export interface ITicketService {
  /** Fetch a single ticket by ID. */
  getTicket(id: string): Promise<Ticket>;
  /** Fetch open tickets assigned to the given user identity. */
  getTicketsForUser(user: string): Promise<Ticket[]>;
  /** Transition a ticket to a new status (e.g. "In Review"). */
  updateStatus(id: string, status: string): Promise<void>;
}
