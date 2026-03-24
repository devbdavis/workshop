/**
 * Domain interfaces for git operations.
 *
 * Infrastructure provides the concrete implementation (child_process-based).
 */
export interface GitStatus {
  branch: string;
  lastCommitHash: string;
  lastCommitMessage: string;
  dirty: boolean;
  modifiedCount: number;
  untrackedCount: number;
  remoteUrl?: string;
}

export interface GitAdapter {
  getStatus(repoPath: string): Promise<GitStatus>;
  isGitRepo(path: string): Promise<boolean>;
}
