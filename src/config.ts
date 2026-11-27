// Site-wide settings. Forks: change REPO_URL to your own repository so the
// "edit this data" and "report a problem" links point at your copy.

export const REPO_URL = 'https://github.com/OLA-AUS/infinity-timeline';
export const DEFAULT_BRANCH = 'main';

/** Link that opens a repo file in GitHub's web editor. Saving there starts a pull request. */
export const editFileUrl = (repoPath: string) => `${REPO_URL}/edit/${DEFAULT_BRANCH}/${repoPath}`;

/** Link to a repo file on GitHub (read-only view, includes its full edit history). */
export const viewFileUrl = (repoPath: string) => `${REPO_URL}/blob/${DEFAULT_BRANCH}/${repoPath}`;

/** Link that opens a new issue from one of the templates in .github/ISSUE_TEMPLATE. */
export const newIssueUrl = (template: string, title: string) =>
  `${REPO_URL}/issues/new?template=${encodeURIComponent(template)}&title=${encodeURIComponent(title)}`;
