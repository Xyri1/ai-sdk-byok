import { AiSdkByokAdapterError } from 'ai-sdk-byok';
import { ChatDemo } from './chat-demo';
import { KeyManagement } from './key-management';
import { byok } from '@/lib/byok';
import { demoUserId } from '@/lib/demo-user';

export const dynamic = 'force-dynamic';

export default async function Page() {
  try {
    const keys = await byok.keys.list({ userId: demoUserId });

    return (
      <main className="shell">
        <section className="toolbar">
          <div>
            <h1>BYOK Keys</h1>
            <p>Save user-owned provider keys, list safe metadata, and use one in an AI SDK route.</p>
          </div>
        </section>
        <KeyManagement keys={keys} />
        <ChatDemo keys={keys} />
      </main>
    );
  } catch (error) {
    if (!(error instanceof AiSdkByokAdapterError)) {
      throw error;
    }

    return (
      <main className="shell">
        <section className="toolbar">
          <div>
            <h1>Database Setup Pending</h1>
            <p>The example can reach the app, but the BYOK metadata query is not ready yet.</p>
          </div>
        </section>
        <section className="notice" role="status">
          <h2>Check Supabase setup</h2>
          <p>Apply the initial migration, confirm Vault is enabled, and make sure `SUPABASE_SECRET_KEY` is a server-side Supabase secret key.</p>
        </section>
      </main>
    );
  }
}
