import { useQuery } from '@tanstack/react-query';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { dhakaTime, ReplayPlayer, replayQuery } from '@/components/admin/ReplayPlayer';
import { buttonStyles, PageContainer } from '@/components/ui';

export const Route = createFileRoute('/_app/admin/replays/$sessionId')({ component: ReplayPage });

function ReplayPage() {
  const { sessionId } = Route.useParams();
  const { data } = useQuery(replayQuery(sessionId));
  return (
    <PageContainer>
      <AdminHeader
        back={
          <Link to="/admin/replays" className={buttonStyles({ variant: 'link', className: 'hit' })}>
            <ArrowLeft className="size-4" aria-hidden /> All recordings
          </Link>
        }
        title="Recording"
        description={
          data && (
            <>
              {dhakaTime(data.startedAt)} (Dhaka){' '}
              {data.userId ? (
                <Link to="/admin/users/$userId" params={{ userId: data.userId }} className={buttonStyles({ variant: 'link' })}>
                  {data.email ?? `Guest ${data.userId.slice(0, 6)}`}
                </Link>
              ) : (
                'Deleted user'
              )}
              {data.userAgent && <span className="block truncate">{data.userAgent}</span>}
            </>
          )
        }
      />
      <ReplayPlayer sessionId={sessionId} />
    </PageContainer>
  );
}
