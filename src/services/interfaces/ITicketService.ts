import type { CreateTicketParams, Ticket, TicketComment } from '../../types';

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
  /** Post a comment on a ticket. */
  addComment(id: string, text: string): Promise<TicketComment>;
  /** List comments on a ticket, oldest first. */
  getComments(id: string): Promise<TicketComment[]>;
  /** Move the ticket to its closed/completed state (providers map to their own closed state). */
  closeTicket(id: string): Promise<void>;
  /** Reopen a previously closed ticket. */
  reopenTicket(id: string): Promise<void>;
  /** Add labels/tags to a ticket, preserving existing ones where the provider supports it. */
  addLabels(id: string, labels: string[]): Promise<void>;
  /** Assign/reassign a ticket to a user. */
  assignTicket(id: string, assignee: string): Promise<void>;
}
