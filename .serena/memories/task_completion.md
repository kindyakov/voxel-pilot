# Task Completion Checklist

Before considering work complete:
- Run `npm run type-check`
- Run `npm run build`
- If changes touch HSM, AI, or memory, also run the relevant focused `npx tsx --test src/tests/...` suites
- Verify behavior-sensitive changes with targeted regression tests when possible
- Summarize what subsystem changed, what behavioral contract changed, and how it was verified
- Review `data/` and `logs/` before committing to avoid leaking runtime artifacts or sensitive information
- If configuration contracts change, update `.env.example` and the related config documentation together