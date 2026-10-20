'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Download, LogOut, Play, Settings, Tag, Upload, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/features/auth/auth.provider';
import {
  type WorkspaceResponse,
  type MemberResponse,
  type MemberRole,
} from '@/features/workspace/workspace.contracts';
import type { DocumentResponse } from '@/features/document/document.contracts';
import {
  ExportFormat,
  Column2Mode,
  type ExportOptions,
} from '@/features/workspace/export.contracts';
import {
  addMemberAction,
  deleteWorkspaceAction,
  removeMemberAction,
  updateMemberRoleAction,
  updateWorkspaceAction,
} from '@/features/workspace/workspace.actions';
import {
  deleteDocumentAction,
  uploadDocumentAction,
} from '@/features/document/document.actions';
import { NotificationDropdown } from '@/features/notifications/components/NotificationDropdown';
import { Sidebar, SidebarItem } from './Sidebar';
import { DocumentGrid, DocumentFilter } from './DocumentGrid';
import { MemberManagement } from './MemberManagement';
import { ExportDialog } from './ExportDialog';
import { toast } from 'sonner';

type Props = {
  workspaceId: string;
  initialWorkspace: WorkspaceResponse;
  initialDocuments: DocumentResponse[];
  initialMembers: MemberResponse[];
};

export function WorkspaceShell({
  workspaceId,
  initialWorkspace,
  initialDocuments,
  initialMembers,
}: Props) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const [workspace, setWorkspace] = useState<WorkspaceResponse>(initialWorkspace);
  const [documents, setDocuments] = useState<DocumentResponse[]>(initialDocuments);
  const [members, setMembers] = useState<MemberResponse[]>(initialMembers);

  // router.refresh() re-renders the RSC but preserves client state, so mirror
  // refreshed server props into local state (upload/delete counts and lists).
  useEffect(() => {
    setWorkspace(initialWorkspace);
    setDocuments(initialDocuments);
    setMembers(initialMembers);
  }, [initialWorkspace, initialDocuments, initialMembers]);

  const currentUserRole = members.find(m => m.userId === user?.id)?.role;
  const isAdmin = currentUserRole === 'ADMIN';

  const [activeSection, setActiveSection] = useState<SidebarItem>('getting-started');
  const [documentFilter, setDocumentFilter] = useState<DocumentFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [updatedName, setUpdatedName] = useState(initialWorkspace.name);
  const [updatedDescription, setUpdatedDescription] = useState(initialWorkspace.description || '');
  const [isUpdating, setIsUpdating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>(ExportFormat.SEPARATE_FILES_ZIP);
  const [column2Mode, setColumn2Mode] = useState<Column2Mode>(Column2Mode.PART_NUMBER);
  const [exportTargetId, setExportTargetId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const getUserInitials = () => {
    if (!user) return 'U';
    const first = user.firstName?.charAt(0) || '';
    const last = user.lastName?.charAt(0) || '';
    return (first + last).toUpperCase() || user.username?.charAt(0)?.toUpperCase() || 'U';
  };

  const getUserDisplayName = () => {
    if (!user) return 'User';
    if (user.firstName) {
      return user.firstName + (user.lastName ? ' ' + user.lastName : '');
    }
    return user.username || 'User';
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
      setIsLoggingOut(false);
    }
  };

  const handleUpdateWorkspace = async () => {
    setIsUpdating(true);
    const result = await updateWorkspaceAction(workspace.id, {
      name: updatedName,
      description: updatedDescription,
    });
    setIsUpdating(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setWorkspace(result.data);
  };

  const handleAddMember = async (email: string, role: MemberRole) => {
    const result = await addMemberAction(workspace.id, { email, role });
    if (!result.ok) {
      toast.error(`Failed to add member: ${result.error}`);
      throw new Error(result.error);
    }
    // The action revalidated the RSC; ask Next to re-render with the
    // fresh member list rather than re-fetching client-side.
    router.refresh();
  };

  const handleRemoveMember = async (userId: string) => {
    if (!confirm('Are you sure you want to remove this member?')) return;
    const prev = members;
    setMembers(prev.filter(m => m.userId !== userId));
    const result = await removeMemberAction(workspace.id, userId);
    if (!result.ok) {
      setMembers(prev);
      toast.error('Failed to remove member.');
    }
  };

  const handleUpdateRole = async (userId: string, newRole: MemberRole) => {
    const prev = members;
    setMembers(prev.map(m => m.userId === userId ? { ...m, role: newRole } : m));
    const result = await updateMemberRoleAction(workspace.id, userId, newRole);
    if (!result.ok) {
      setMembers(prev);
      toast.error('Failed to update role.');
    }
  };

  const handleDeleteDocument = async (documentId: string) => {
    if (!confirm('Are you sure you want to delete this document?')) return;
    const prev = documents;
    setDocuments(prev.filter(d => d.id !== documentId));
    const result = await deleteDocumentAction(workspace.id, documentId);
    if (!result.ok) {
      setDocuments(prev);
      toast.error('Failed to delete document.');
      return;
    }
    setWorkspace(prev => ({
      ...prev,
      documentCount: Math.max(0, prev.documentCount - 1),
    }));
    // Document counts on the workspace change; re-render the RSC.
    router.refresh();
  };

  const handleDeleteWorkspace = async () => {
    if (!confirm(`Are you sure you want to delete workspace "${workspace.name}"? This action cannot be undone.`)) return;
    const result = await deleteWorkspaceAction(workspace.id);
    if (!result.ok) {
      toast.error('Failed to delete workspace.');
      return;
    }
    router.push('/home');
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    const result = await uploadDocumentAction(workspace.id, formData);
    setIsUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!result.ok) {
      console.error('Failed to upload document:', result.error);
      toast.error('Failed to upload document.');
      return;
    }
    if (result.data) {
      const uploaded = result.data;
      setDocuments(prev =>
        prev.some(doc => doc.id === uploaded.id) ? prev : [uploaded, ...prev],
      );
      setWorkspace(prev => ({
        ...prev,
        documentCount: prev.documentCount + 1,
        updatedAt: new Date().toISOString(),
      }));
    }
    // Re-render the RSC so workspace counts refresh.
    router.refresh();
  };

  const openExportDialog = (documentId?: string) => {
    setExportTargetId(documentId || null);
    setIsExportDialogOpen(true);
    setExportFormat(ExportFormat.SEPARATE_FILES_ZIP);
    setColumn2Mode(Column2Mode.PART_NUMBER);
  };

  const handleExportAction = async () => {
    try {
      setIsExporting(true);
      const options: ExportOptions = {
        column2Mode,
        exportFormat,
        continueSentenceNumbers: true,
        defaultPartNumber: 0,
      };

      const target = exportTargetId
        ? { type: 'documents', id: exportTargetId }
        : { type: 'workspaces', id: workspace.id };
      const res = await fetch(`/api/export/${target.type}/${target.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
      });
      if (!res.ok) {
        throw new Error(`Export failed (${res.status})`);
      }

      const contentDisposition = res.headers.get('Content-Disposition');
      let filename = exportTargetId ? 'export.conll' : 'export.zip';
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match?.[1]) filename = match[1];
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      setIsExportDialogOpen(false);
    } catch (error) {
      console.error('Failed to export:', error);
      toast.error('Failed to export.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/30 to-purple-50/30 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
        <header className="border-b border-slate-200/60 dark:border-slate-800/60 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl sticky top-0 z-50 shadow-sm">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-8">
              <Image
                src="/genesis-logo.svg"
                alt="Genesis Logo"
                width={120}
                height={55}
                priority
                className="h-10 w-auto cursor-pointer"
                onClick={() => router.push('/home')}
              />
              <div className="border-l border-slate-300 dark:border-slate-700 pl-8">
                <h1 className="text-lg font-bold text-slate-900 dark:text-white">{workspace.name}</h1>
                <p className="text-sm text-slate-600 dark:text-slate-400">{workspace.annotationType}</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <NotificationDropdown />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Avatar aria-label="User menu" className="cursor-pointer ring-2 ring-white dark:ring-slate-800 hover:shadow-lg transition-shadow">
                    <AvatarFallback className="bg-gradient-to-br from-[var(--primary)] to-purple-600 text-white font-bold">
                      {getUserInitials()}
                    </AvatarFallback>
                  </Avatar>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none">{getUserDisplayName()}</p>
                      <p className="text-xs leading-none text-muted-foreground">{user?.email}</p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="cursor-pointer">
                    <User className="mr-2 h-4 w-4" />
                    <span>Profile</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem className="cursor-pointer">
                    <Settings className="mr-2 h-4 w-4" />
                    <span>Settings</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="cursor-pointer text-red-600 dark:text-red-400 focus:text-red-600 dark:focus:text-red-400"
                    onClick={handleLogout}
                    disabled={isLoggingOut}
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>{isLoggingOut ? 'Logging out...' : 'Log out'}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        <div className="flex max-w-7xl mx-auto">
          <Sidebar
            workspace={workspace}
            activeSection={activeSection}
            isAdmin={isAdmin}
            onChangeSection={setActiveSection}
            onBack={() => router.push('/home')}
          />

          <main className="flex-1 p-8">
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              onChange={handleFileUpload}
            />

            {activeSection === 'getting-started' && (
              <div>
                <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-6">Getting Started</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Card className="hover:shadow-lg transition-shadow cursor-pointer group">
                    <CardHeader>
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[var(--primary)] to-blue-600 flex items-center justify-center text-white mb-4 group-hover:scale-110 transition-transform">
                        <Play className="w-5 h-5" />
                      </div>
                      <CardTitle>Open Editor</CardTitle>
                      <CardDescription>Start annotating documents in the annotation editor</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button className="w-full" onClick={() => router.push(`/workspace/${workspaceId}/editor`)}>
                        Launch Editor
                      </Button>
                    </CardContent>
                  </Card>

                  <Card className="hover:shadow-lg transition-shadow cursor-pointer group">
                    <CardHeader>
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white mb-4 group-hover:scale-110 transition-transform">
                        <Download className="w-5 h-5" />
                      </div>
                      <CardTitle>Export Documents</CardTitle>
                      <CardDescription>Download annotated documents in various formats</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button variant="outline" className="w-full" onClick={() => openExportDialog()}>Export</Button>
                    </CardContent>
                  </Card>

                  <Card className="hover:shadow-lg transition-shadow cursor-pointer group">
                    <CardHeader>
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center text-white mb-4 group-hover:scale-110 transition-transform">
                        <Upload className="w-5 h-5" />
                      </div>
                      <CardTitle>Import Documents</CardTitle>
                      <CardDescription>Upload new documents to this workspace</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button variant="outline" className="w-full" onClick={() => fileInputRef.current?.click()}>
                        Import
                      </Button>
                    </CardContent>
                  </Card>

                  <Card className="hover:shadow-lg transition-shadow">
                    <CardHeader>
                      <CardTitle className="text-lg">Quick Statistics</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-slate-600 dark:text-slate-400">Total Documents</span>
                          <span className="font-bold text-lg">{workspace.documentCount}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-slate-600 dark:text-slate-400">Annotated</span>
                          <span className="font-bold text-lg text-green-600">{workspace.annotatedDocumentCount}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-slate-600 dark:text-slate-400">Remaining</span>
                          <span className="font-bold text-lg text-orange-600">{workspace.documentCount - workspace.annotatedDocumentCount}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-slate-600 dark:text-slate-400">Team Members</span>
                          <span className="font-bold text-lg">{members.length}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            {activeSection === 'documents' && (
              <DocumentGrid
                documents={documents}
                filter={documentFilter}
                onChangeFilter={setDocumentFilter}
                searchQuery={searchQuery}
                onChangeSearch={setSearchQuery}
                isUploading={isUploading}
                onUploadClick={() => fileInputRef.current?.click()}
                onAnnotate={() => router.push(`/workspace/${workspaceId}/editor`)}
                onExportDocument={openExportDialog}
                onDeleteDocument={handleDeleteDocument}
              />
            )}

            {activeSection === 'collaborators' && (
              <MemberManagement
                members={members}
                isAdmin={isAdmin}
                currentUserId={user?.id}
                onAddMember={handleAddMember}
                onRemoveMember={handleRemoveMember}
                onUpdateRole={handleUpdateRole}
              />
            )}

            {activeSection === 'schema' && (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-3xl font-bold text-slate-900 dark:text-white">Annotation Schema</h2>
                  <Button className="gap-2" disabled>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Layer
                  </Button>
                </div>

                <Card>
                  <CardContent className="py-12 text-center">
                    <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <Tag className="w-5 h-5" />
                    </div>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Coming Soon</h3>
                    <p className="text-slate-600 dark:text-slate-400 mb-6">
                      Advanced schema management will be available in the next update.
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}

            {activeSection === 'settings' && isAdmin && (
              <div>
                <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-6">Settings</h2>

                <div className="space-y-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>General</CardTitle>
                      <CardDescription>Basic workspace configuration</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          Workspace Name
                        </label>
                        <Input value={updatedName} onChange={(e) => setUpdatedName(e.target.value)} />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          Description
                        </label>
                        <Input value={updatedDescription} onChange={(e) => setUpdatedDescription(e.target.value)} />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          Annotation Type
                        </label>
                        <Input value={workspace.annotationType} disabled className="bg-slate-100 dark:bg-slate-800" />
                        <p className="text-xs text-slate-500">Annotation type cannot be changed after creation</p>
                      </div>

                      <div className="pt-4">
                        <Button onClick={handleUpdateWorkspace} disabled={isUpdating}>
                          {isUpdating ? 'Saving...' : 'Save Changes'}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-red-200 dark:border-red-900 mt-8">
                    <CardHeader>
                      <CardTitle className="text-red-600 dark:text-red-400">Danger Zone</CardTitle>
                      <CardDescription>Irreversible actions for this workspace</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center justify-between p-4 border border-red-100 dark:border-red-900/50 rounded-lg bg-red-50 dark:bg-red-900/10">
                        <div>
                          <h4 className="font-medium text-red-900 dark:text-red-200">Delete Workspace</h4>
                          <p className="text-sm text-red-700 dark:text-red-300">
                            Permanently delete this workspace and all its documents
                          </p>
                        </div>
                        <Button variant="destructive" onClick={handleDeleteWorkspace}>
                          Delete Workspace
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>

      <ExportDialog
        open={isExportDialogOpen}
        onOpenChange={setIsExportDialogOpen}
        targetIsDocument={exportTargetId !== null}
        format={exportFormat}
        onChangeFormat={setExportFormat}
        column2Mode={column2Mode}
        onChangeColumn2Mode={setColumn2Mode}
        isExporting={isExporting}
        onExport={handleExportAction}
      />
    </>
  );
}
