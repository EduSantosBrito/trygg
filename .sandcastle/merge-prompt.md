# TASK

Integrate the following Git sandbox branches into the current jj working copy. Linear history required; no merge commits; no empty commits.

Start by running `jj git import` so jj sees the Git commits produced by the sandboxes.

Current jj position: run `jj log -r '@' --no-graph` to confirm.

{{BRANCHES}}

For each branch:

1. Confirm jj can see it with `jj log -r <branch> --no-graph`
2. Rebase only the branch's unique stack onto current `@`: `jj rebase -s 'roots(::<branch> ~ ::@)' -d @`
3. If there are conflicts:
   - jj writes conflict markers in affected files — read them with `jj resolve --list`
   - Resolve each file intelligently by reading both sides
   - Mark resolved files with `jj resolve <file>`
4. `jj edit <branch>` to move the working copy to the tip of the integrated stack. Do not use `jj new <branch>`; that creates empty integration commits.
5. Run `bun run typecheck` and `bun run test` to verify everything works
6. If tests fail, fix the issues before proceeding to the next branch

For subsequent branches, rebase onto the updated `@` so changes stack linearly.

After all branches are integrated:

1. Run `jj abandon 'empty() & (main@origin..@)'` to remove accidental empty outgoing commits.
2. Run `jj log -r 'main@origin..@ & description(exact:"")' --no-graph`; if anything appears, describe those commits before continuing.
3. Run `jj log -r 'main@origin..@' --no-graph -T 'if(author.name() == "" || author.email() == "" || committer.name() == "" || committer.email() == "", change_id.short() ++ "\n")'`; if anything appears, repair it with `env JJ_USER='{{VCS_USER}}' JJ_EMAIL='{{VCS_EMAIL}}' jj metaedit --update-author --force-rewrite <change-id>`.
4. Do not rewrite issue commit descriptions into generic integration messages.
5. Do not push.

The host runner performs final bookmark cleanup, `main` movement, and `jj git export` after this prompt succeeds.

# CLOSE ISSUES

For each integrated bookmark, close its issue using the following command:

`gh issue close <issue-id> --comment "Completed by Sandcastle"`

Here are all the issues:

{{ISSUES}}

Once all bookmarks are integrated, output <promise>COMPLETE</promise>.
