import { redirect } from 'next/navigation';
import type { AnnotationType } from '@/features/workspace/workspace.contracts';
import { SessionExpiredError } from '@/server/errors';
import { getWorkspaceById } from '@/features/workspace/workspace.gateway';
import { isOneOf } from '@/lib/utils';
import CorefEditor from '@/features/editor/coref/components/CorefEditor';
import NerEditor from '@/features/editor/ner/components/NerEditor';
import PosEditor from '@/features/editor/pos/components/PosEditor';
import WsdEditor from '@/features/editor/wsd/components/WsdEditor';

const ANNOTATION_TYPES: readonly AnnotationType[] = ['COREF', 'NER', 'POS', 'WSD'];

/**
 * Resolves a workspace's annotation type server-side and dispatches to the
 * matching editor. The route segment is a thin wrapper around this.
 */
export default async function EditorDispatch({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let annotationType: AnnotationType;
  let workspaceName: string;
  try {
    const workspace = await getWorkspaceById(id);
    if (!isOneOf(workspace.annotationType, ANNOTATION_TYPES)) {
      throw new Error(`Unknown annotation type from server: ${workspace.annotationType}`);
    }
    annotationType = workspace.annotationType;
    workspaceName = workspace.name;
  } catch (err) {
    if (err instanceof SessionExpiredError) {
      redirect('/api/auth/end-session');
    }
    throw err;
  }

  switch (annotationType) {
    case 'COREF':
      return <CorefEditor workspaceId={id} workspaceName={workspaceName} />;
    case 'NER':
      return <NerEditor workspaceId={id} workspaceName={workspaceName} />;
    case 'POS':
      return <PosEditor workspaceId={id} workspaceName={workspaceName} />;
    case 'WSD':
      return <WsdEditor workspaceId={id} workspaceName={workspaceName} />;
  }
}
