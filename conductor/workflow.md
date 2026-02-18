# Project Workflow

## Guiding Principles

1. **The Plan is the Source of Truth:** All work must be tracked in `plan.md`
2. **The Tech Stack is Deliberate:** Changes to the tech stack must be documented in `tech-stack.md` *before* implementation
3. **Test-Driven Development:** Write unit tests before implementing functionality
4. **High Code Coverage:** Aim for >80% code coverage for all modules
5. **User Experience First:** Every decision should prioritize user experience
6. **Non-Interactive & CI-Aware:** Prefer non-interactive commands. Use `CI=true` for watch-mode tools (tests, linters) to ensure single execution.
7. **Verify Before Commit:** Code must be reviewed and tested before git commit.
8. **E2E Testing Preference:** Always prefer end-to-end (E2E) testing performed by the AI agent whenever possible (e.g., environment-specific validation, cluster state checks) over manual user verification.
9. **Verify Dependencies:** Always web search to confirm library versions, features, and usage.
10. **Git Safety:** NEVER use `git add .`. Always stage specific files (e.g., `git add path/to/file`) to avoid accidental commits of untracked files or unintended changes.

## Task Workflow

All tasks follow a strict lifecycle:

### Standard Task Workflow

1. **Select Task:** Choose the next available task from `plan.md` in sequential order

2. **Mark In Progress:** Before beginning work, edit `plan.md` and change the task from `[ ]` to `[~]`

3. **Write Failing Tests (Red Phase):**
   - Create a new test file for the feature or bug fix.
   - Write one or more unit tests that clearly define the expected behavior and acceptance criteria for the task.
   - **CRITICAL:** Run the tests and confirm that they fail as expected. This is the "Red" phase of TDD. Do not proceed until you have failing tests.

4. **Implement to Pass Tests (Green Phase):**
   - Write the minimum amount of application code necessary to make the failing tests pass.
   - Run the test suite again and confirm that all tests now pass. This is the "Green" phase.

5. **Refactor (Optional but Recommended):**
   - With the safety of passing tests, refactor the implementation code and the test code to improve clarity, remove duplication, and enhance performance without changing the external behavior.
   - Rerun tests to ensure they still pass after refactoring.

6. **Verify Coverage:** Run coverage reports using the project's chosen tools. For example, in a Python project, this might look like:
   ```bash
   pytest --cov=app --cov-report=html
   ```
   Target: >80% coverage for new code. The specific tools and commands will vary by language and framework.

7. **Document Deviations:** If implementation differs from tech stack:
   - **STOP** implementation
   - Update `tech-stack.md` with new design
   - Add dated note explaining the change
   - Resume implementation

8. **Verify & Commit Code Changes:**
   - **Step 8.1: Verify Dependencies:** If the task involved adding new libraries or using specific features, you MUST perform a web search to confirm the library version, package name, and that the feature exists as implemented.
   - **Step 8.2: Final Verification:** Run the code/tests one last time to ensure everything is working as expected *before* committing.
   - **Step 8.3: User Validation (If Required):** If the task involves UI changes, complex user flows, or any functionality that cannot be fully verified via automated tests, explicitly describe the changes to the user, ask them to perform a manual test, and wait for their confirmation/feedback before proceeding.
   - **Step 8.4: Stage & Commit:** Stage all code changes related to the task.
   - **Step 8.5: Commit:** Propose a clear, concise commit message e.g, `feat(ui): Create basic HTML structure for calculator`, and perform the commit.

9. **Attach Task Summary with Git Notes:**
   - **Step 9.1: Get Commit Hash:** Obtain the hash of the *just-completed commit* (`git log -1 --format="%H"`).
   - **Step 9.2: Draft Note Content:** Create a detailed summary for the completed task. This should include the task name, a summary of changes, a list of all created/modified files, and the core "why" for the change.
   - **Step 9.3: Attach Note:** Use the `git notes` command to attach the summary to the commit.
     ```bash
     # The note content from the previous step is passed via the -m flag.
     git notes add -m "<note content>" <commit_hash>
     ```

10. **Get and Record Task Commit SHA:**
    - **Step 10.1: Update Plan:** Read `plan.md`, find the line for the completed task, update its status from `[~]` to `[x]`, and append the first 7 characters of the *just-completed commit's* commit hash.
    - **Step 10.2: Write Plan:** Write the updated content back to `plan.md`.

11. **Commit Plan Update:**
    - **Action:** Stage the modified `plan.md` file.
    - **Action:** Commit this change with a descriptive message (e.g., `conductor(plan): Mark task 'Create user model' as complete`).

## 4. Phase Completion Verification and Checkpointing Protocol

**AI AGENT INSTRUCTION: This section is adapted to the project's specific language, framework, and build tools.**

At the end of *every* phase (as defined in `plan.md`), you MUST perform the following verification steps to ensure the project remains stable and buildable.

1.  **Build Verification:**
    *   Execute the build command: `npm run build`
    *   **Action:** If the build fails, you MUST fix the errors before marking the phase as complete.

2.  **Linting and Style Check:**
    *   Execute the linter: `npm run lint`
    *   **Action:** Resolve all reported linting issues.

3.  **Type Checking:**
    *   Execute the type checker: `npm run type-check`
    *   **Action:** Fix all type errors.

4.  **Test Execution:**
    *   Execute the test suite: `npm test`
    *   **Constraint:** You MUST NOT use the `--workspaces` flag with `npm test`.
    *   **Action:** Ensure all tests pass. If any tests fail, diagnose and fix the issues.

5.  **Checkpoint Creation:**
    *   Once all verifications pass (Build, Lint, Type Check, Tests), create a checkpoint commit.
    *   **Command:** `git add . && git commit -m "chore(checkpoint): complete phase <Phase Name>"`
    *   **Note:** Replace `<Phase Name>` with the actual name of the phase you just completed.

6.  **Progress Update:**
    *   Mark the phase as complete in the `plan.md` file.
    *   **Git Note:** Add a git note to the checkpoint commit summarizing the phase completion: `git notes add -m "Phase <Phase Name> completed. All verification checks passed."`

7.  **STOP AND WAIT:**
    *   **CRITICAL:** You MUST STOP after completing the above steps for a phase.
    *   **DO NOT** automatically proceed to the next phase.
    *   **DO NOT** mark the "User Manual Verification" task as complete yourself.
    *   **Announce:** "Phase <Phase Name> is complete. All automated checks passed. Please perform the manual verification step defined in the plan and tell me when to proceed."
    *   **Wait:** You must receive explicit confirmation from the user (e.g., "Phase verified") before checking off the verification task and moving to the next phase.

**CRITICAL:** Do not proceed to the next phase until *all* steps in this protocol are successfully completed. This ensures a clean slate for the subsequent set of tasks.

### Quality Gates

Before marking any task complete, verify:

- [ ] All tests pass
- [ ] Code coverage meets requirements (>80%)
- [ ] Code follows project's code style guidelines (as defined in `code_styleguides/`)
- [ ] All public functions/methods are documented (e.g., docstrings, JSDoc, GoDoc)
- [ ] Type safety is enforced (e.g., type hints, TypeScript types, Go types)
- [ ] No linting or static analysis errors (using the project's configured tools)
- [ ] Works correctly on mobile (if applicable)
- [ ] Documentation updated if needed
- [ ] No security vulnerabilities introduced

## Development Commands

**AI AGENT INSTRUCTION: This section should be adapted to the project's specific language, framework, and build tools.**

### Setup
```bash
# Example: Commands to set up the development environment (e.g., install dependencies, configure database)
# e.g., for a Node.js project: npm install
# e.g., for a Go project: go mod tidy
```

### Daily Development
```bash
# Example: Commands for common daily tasks (e.g., start dev server, run tests, lint, format)
# e.g., for a Node.js project: npm run dev, npm test, npm run lint
# e.g., for a Go project: go run main.go, go test ./..., go fmt ./...
```

### Before Committing
```bash
# Example: Commands to run all pre-commit checks (e.g., format, lint, type check, run tests)
# e.g., for a Node.js project: npm run check
# e.g., for a Go project: make check (if a Makefile exists)
```

## Testing Requirements

### GitOps Feature Verification
When verifying changes in a GitOps environment (FluxCD):
1.  **Pre-Flight:** Check controller health (`kubectl get pods -n flux-system`) before starting.
2.  **Branching:** Push changes to a feature branch.
3.  **Targeting:** Update the `GitRepository` source in the cluster (via `kubectl apply`) to point to the feature branch.
    *   **CRITICAL:** Verify the local file content matches the desired branch reference before applying.
4.  **Reconciliation:**
    *   Trigger source reconciliation: `flux reconcile source git <name> -n <namespace>`
    *   Trigger app reconciliation: `kubectl annotate --overwrite <kind> <name> -n <namespace> reconcile.fluxcd.io/requestedAt="$(date +%s)"`
5.  **Verification:** Monitor status via `kubectl get <kind> <name>` and logs. Verify actual infrastructure state (e.g., AWS CLI) once Applied.
6.  **Cleanup:** ALWAYS revert the `GitRepository` source to its original branch (e.g., `staging` or `main`) after verification is complete.

### Unit Testing
- Every module must have corresponding tests.
- Use appropriate test setup/teardown mechanisms (e.g., fixtures, beforeEach/afterEach).
- Mock external dependencies.
- Test both success and failure cases.

### Integration Testing
- Test complete user flows
- Verify database transactions
- Test authentication and authorization
- Check form submissions

### Mobile Testing
- Test on actual iPhone when possible
- Use Safari developer tools
- Test touch interactions
- Verify responsive layouts
- Check performance on 3G/4G

## Code Review Process

### Self-Review Checklist
Before requesting review:

1. **Functionality**
   - Feature works as specified
   - Edge cases handled
   - Error messages are user-friendly

2. **Code Quality**
   - Follows style guide
   - DRY principle applied
   - Clear variable/function names
   - Appropriate comments

3. **Testing**
   - Unit tests comprehensive
   - Integration tests pass
   - Coverage adequate (>80%)

4. **Security**
   - No hardcoded secrets
   - Input validation present
   - SQL injection prevented
   - XSS protection in place

5. **Performance**
   - Database queries optimized
   - Images optimized
   - Caching implemented where needed

6. **Mobile Experience**
   - Touch targets adequate (44x44px)
   - Text readable without zooming
   - Performance acceptable on mobile
   - Interactions feel native

## Commit Guidelines

### Message Format
```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Formatting, missing semicolons, etc.
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `test`: Adding missing tests
- `chore`: Maintenance tasks

### Examples
```bash
git commit -m "feat(auth): Add remember me functionality"
git commit -m "fix(posts): Correct excerpt generation for short posts"
git commit -m "test(comments): Add tests for emoji reaction limits"
git commit -m "style(mobile): Improve button touch targets"
```

## Definition of Done

A task is complete when:

1. All code implemented to specification
2. Unit tests written and passing
3. Code coverage meets project requirements
4. Documentation complete (if applicable)
5. Code passes all configured linting and static analysis checks
6. Works beautifully on mobile (if applicable)
7. Implementation notes added to `plan.md`
8. Changes committed with proper message
9. Git note with task summary attached to the commit

## Emergency Procedures

### Critical Bug in Production
1. Create hotfix branch from main
2. Write failing test for bug
3. Implement minimal fix
4. Test thoroughly including mobile
5. Deploy immediately
6. Document in plan.md

### Data Loss
1. Stop all write operations
2. Restore from latest backup
3. Verify data integrity
4. Document incident
5. Update backup procedures

### Security Breach
1. Rotate all secrets immediately
2. Review access logs
3. Patch vulnerability
4. Notify affected users (if any)
5. Document and update security procedures

## Deployment Workflow

### Pre-Deployment Checklist
- [ ] All tests passing
- [ ] Coverage >80%
- [ ] No linting errors
- [ ] Mobile testing complete
- [ ] Environment variables configured
- [ ] Database migrations ready
- [ ] Backup created

### Deployment Steps
1. Merge feature branch to main
2. Tag release with version
3. Push to deployment service
4. Run database migrations
5. Verify deployment
6. Test critical paths
7. Monitor for errors

### Post-Deployment
1. Monitor analytics
2. Check error logs
3. Gather user feedback
4. Plan next iteration

## Continuous Improvement

- Review workflow weekly
- Update based on pain points
- Document lessons learned
- Optimize for user happiness
- Keep things simple and maintainable
