/**
 * Generates a git branch name from a ticket ID and title.
 *
 * Examples:
 *   generateBranchName('123',      'Fix login button')   → '123-fix-login-button'
 *   generateBranchName('PROJ-456', 'Add dark mode')      → 'proj-456-add-dark-mode'
 */
export function generateBranchName(ticketId: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')   // drop special chars except hyphens
    .trim()
    .replace(/\s+/g, '-')       // spaces → hyphens
    .replace(/-+/g, '-')        // collapse consecutive hyphens
    .replace(/^-|-$/g, '')      // trim leading/trailing hyphens
    .slice(0, 50);              // cap length

  const idPart = ticketId.toLowerCase().replace(/\s+/g, '-');
  return `${idPart}-${slug}`;
}
