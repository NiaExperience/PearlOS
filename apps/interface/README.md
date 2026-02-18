# Nia Interface

The Nia Interface is the **user-facing application** for interacting with Nia assistants in the Nia-Universal platform. It provides a rich interactive experience for users to communicate with assistants and access assistant functionality. The Interface is built on a **provider-agnostic, backend-agnostic architecture** powered by the [Nia Data Prism](../../packages/prism/README.md).

---

## Architecture: Interface + Prism

### What is Prism?

[Prism](../../packages/prism/README.md) is a universal data abstraction layer that provides a unified, provider-agnostic API for all content and assistant operations. It enables the interface to:

- Query any content type (dynamic or static) using generic APIs
- Remain agnostic to the underlying data provider (Postgres, MongoDB, APIs, etc.)
- Support dynamic content types defined at migration/runtime
- Enforce tenant and assistant scoping for all data operations

### Interface's Role

- **User App:** The interface is the primary UI for users to interact with assistants
- **Content-Type Agnostic:** All content operations are routed through Prism's generic APIs
- **Tenant-Aware:** All queries and mutations are scoped to the user's tenant
- **Assistant-Aware:** Features are specific to the assistant the user is interacting with

---

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm run start
```

The Interface app runs on [http://localhost:3000](http://localhost:3000) by default.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/deployment) for more details.
