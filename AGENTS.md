<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Project rules
- Voting UI talks only to the `VotingService` interface (src/features/voting/types.ts); swap implementations in service.ts. Why: the real backend/AWS RDS API is owned by another developer and must drop in without UI rewrites.
- Never connect to PostgreSQL or hold DB credentials in this app. Why: browser code is public; the backend is the only DB client.
- Design values come from the supplied Figma CSS exports and live as tokens/@utility classes in src/styles.css. Why: the screenshots are the source of truth.
- See docs/voting-integration.md for API contract and open items.
