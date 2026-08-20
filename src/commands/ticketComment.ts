import chalk from 'chalk';
import { errMsg } from '../utils/errors';
import { container } from '../container';
import { TOKENS } from '../tokens';
import type { ITicketService } from '../services/interfaces/ITicketService';
import type { TicketComment } from '../types';

export interface TicketCommentOptions {
  json?: boolean;
}

function formatDate(date: Date): string {
  return date.toISOString();
}

function printComment(comment: TicketComment): void {
  process.stdout.write(
    `${chalk.dim(`#${comment.id} — ${formatDate(comment.publishedAt)}`)}\n` +
    `${chalk.dim('Author:')} ${comment.author}\n` +
    `${comment.content}\n`,
  );
}

export async function ticketCommentCommand(
  ticketId: string,
  text: string,
  options: TicketCommentOptions = {},
): Promise<void> {
  const ticketSvc = container.resolve<ITicketService>(TOKENS.TicketService);
  const content = text.trim();

  if (!content) {
    console.error(chalk.red('Comment text cannot be empty.'));
    process.exit(1);
  }

  try {
    const comment = await ticketSvc.addComment(ticketId, content);

    if (options.json) {
      process.stdout.write(JSON.stringify(comment, null, 2) + '\n');
      return;
    }

    console.log(chalk.green('✓') + ` Comment added to ${chalk.cyan(`#${ticketId}`)}`);
  } catch (err: unknown) {
    if (options.json) {
      process.stdout.write(JSON.stringify({ error: errMsg(err) }) + '\n');
    } else {
      console.error(chalk.red(`Failed to add comment: ${errMsg(err)}`));
    }
    process.exit(1);
  }
}

export async function ticketCommentsCommand(
  ticketId: string,
  options: TicketCommentOptions = {},
): Promise<void> {
  const ticketSvc = container.resolve<ITicketService>(TOKENS.TicketService);

  try {
    const comments = await ticketSvc.getComments(ticketId);

    if (options.json) {
      process.stdout.write(JSON.stringify(comments, null, 2) + '\n');
      return;
    }

    if (comments.length === 0) {
      console.log(chalk.dim(`No comments on ${chalk.cyan(`#${ticketId}`)} yet.`));
      return;
    }

    console.log(chalk.dim(`Comments on ${chalk.cyan(`#${ticketId}`)}:`));
    comments.forEach((comment, index) => {
      if (index > 0) process.stdout.write('\n');
      printComment(comment);
    });
  } catch (err: unknown) {
    if (options.json) {
      process.stdout.write(JSON.stringify({ error: errMsg(err) }) + '\n');
    } else {
      console.error(chalk.red(`Failed to load comments: ${errMsg(err)}`));
    }
    process.exit(1);
  }
}