Integrate branch {{BRANCH}} into the current trunk for issue {{ISSUE_FILE}}.

Do not create merge commits. This repository uses trunk-based stacked history.
For jj, integrating an issue means the current trunk working-copy commit is rebased on top of the issue head, preserving a linear stack. Do not create a sibling issue head beside trunk.

VCS:

{{VCS_INSTRUCTIONS}}

SOURCE:

{{SOURCE_INSTRUCTIONS}}

Issue body:

{{ISSUE_BODY}}

Steps:

{{MERGE_STEPS}}
