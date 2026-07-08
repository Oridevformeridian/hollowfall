# Agent Rules and Guidelines (GEMINI.md)

This file contains behavioral guidelines, workflows, and developer preferences that **Antigravity (GEMINI CLI)** must follow when working in this repository.

---

## 1. Approval and Change Workflows

*   **Ask for Approval**: You **must** present a plan and obtain explicit user approval before making any major code changes (e.g. creating new files, rewriting existing logic, modifying schema definitions).
*   **Agile Scope**: Target individual specification elements one-by-one (incremental, iterative changes) rather than attempting to implement massive chunks of the spec at once.

---

## 2. Git and Version Control Strategy

*   **Feature Branches**: The default unit of change is a Git feature branch. For any new feature or task:
    1.  Create and checkout a new local feature branch named descriptive of the task (e.g., `feature/lobby-setup-spec`).
    2.  Write/modify code incrementally.
    3.  Commit changes with clear, descriptive commit messages.
    4.  Push the feature branch to the remote repository (`origin`).
    5.  Request the user to review and merge the branch.
*   **No Direct Push to Main**: Do not commit directly to `main` unless explicitly requested.
