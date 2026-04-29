# TASK

Integrate the following Git sandbox branches into the current jj working copy. Linear history required; no merge commits.

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
4. `jj new <branch>` to advance the working copy to the tip of the integrated stack
5. Run `bun run typecheck` and `bun run test` to verify everything works
6. If tests fail, fix the issues before proceeding to the next branch

For subsequent branches, rebase onto the updated `@` so changes stack linearly.

After all branches are integrated, run `jj desc -m "sandcastle: integrate <list-of-branches>"` to describe the working copy, then run `jj git export` so Git refs are synchronized.

# CLOSE ISSUES

For each integrated bookmark, close its issue using the following command:

`gh issue close <issue-id> --comment "Completed by Sandcastle"`

Here are all the issues:

{{ISSUES}}

Once all bookmarks are integrated, output <promise>COMPLETE</promise>.
