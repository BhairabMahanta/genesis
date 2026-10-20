'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth, useRequireAuth } from '@/features/auth/auth.provider';
import { WorkspaceResponse, CreateWorkspaceRequest } from '@/features/workspace/workspace.contracts';
import { createWorkspaceAction } from '@/features/workspace/workspace.actions';
import {
  Search,
  Plus,
  LogOut,
  Settings,
  User,
  LayoutGrid,
  List,
  X,
  ArrowUpDown,
} from 'lucide-react';
import { NotificationDropdown } from '@/features/notifications/components/NotificationDropdown';
import { ExecutiveMetrics } from './ExecutiveMetrics';
import { WorkspaceCard } from './WorkspaceCard';
import { WorkspaceRow } from './WorkspaceRow';
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog';

interface HomeClientProps {
  initialWorkspaces: WorkspaceResponse[];
}

type ViewMode = 'grid' | 'list';
type SortOption = 'recent' | 'progress_desc' | 'progress_asc' | 'alphabetical';
type FilterTab = 'ALL' | 'NER' | 'COREF' | 'POS' | 'WSD';

export function HomeClient({ initialWorkspaces }: HomeClientProps) {
  const router = useRouter();
  const { user, logout } = useAuth();
  useRequireAuth();
  const reduceMotion = useReducedMotion();

  const [workspaces, setWorkspaces] = useState<WorkspaceResponse[]>(initialWorkspaces);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTab, setSelectedTab] = useState<FilterTab>('ALL');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [isNewWorkspaceOpen, setIsNewWorkspaceOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut listener: '/' to focus search, 'Escape' to clear
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input or textarea
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        if (e.key === 'Escape') {
          setSearchQuery('');
          (e.target as HTMLElement).blur();
        }
        return;
      }

      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleCreateWorkspace = async (request: CreateWorkspaceRequest) => {
    setCreateError(null);
    try {
      setIsCreating(true);
      const result = await createWorkspaceAction(request);
      if (!result.ok) {
        setCreateError(result.error);
        return;
      }
      setWorkspaces((prev) => [result.data, ...prev]);
      setIsNewWorkspaceOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create workspace';
      console.error('Failed to create workspace:', error);
      setCreateError(message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
      setIsLoggingOut(false);
    }
  };

  const getUserInitials = () => {
    if (!user) return 'U';
    const first = user.firstName?.charAt(0) || '';
    const last = user.lastName?.charAt(0) || '';
    return (first + last).toUpperCase() || user.username?.charAt(0)?.toUpperCase() || 'U';
  };

  const getUserDisplayName = () => {
    if (!user) return 'Researcher';
    if (user.firstName) {
      return user.firstName + (user.lastName ? ' ' + user.lastName : '');
    }
    return user.username || 'Researcher';
  };

  // Filter and Sort Pipeline
  const filteredAndSortedWorkspaces = useMemo(() => {
    const result = workspaces.filter((w) => {
      const matchesSearch =
        w.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        w.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        w.annotationType.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesTab = selectedTab === 'ALL' || w.annotationType === selectedTab;

      return matchesSearch && matchesTab;
    });

    result.sort((a, b) => {
      switch (sortBy) {
        case 'progress_desc':
          return b.progressPercentage - a.progressPercentage;
        case 'progress_asc':
          return a.progressPercentage - b.progressPercentage;
        case 'alphabetical':
          return a.name.localeCompare(b.name);
        case 'recent':
        default:
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
    });

    return result;
  }, [workspaces, searchQuery, selectedTab, sortBy]);

  // Tab counts
  const tabCounts = useMemo(() => {
    const counts = { ALL: workspaces.length, NER: 0, COREF: 0, POS: 0, WSD: 0 };
    workspaces.forEach((w) => {
      if (w.annotationType in counts) {
        counts[w.annotationType as keyof typeof counts]++;
      }
    });
    return counts;
  }, [workspaces]);

  const filterTabs: FilterTab[] = ['ALL', 'NER', 'COREF', 'POS', 'WSD'];

  return (
    <div className="min-h-screen bg-slate-50/70 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans">
      {/* Refined Header */}
      <header className="border-b border-slate-200/70 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl sticky top-0 z-40 transition-colors">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          {/* Logo & Product Tag */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => router.push('/home')}>
              <Image
                src="/genesis-logo.svg"
                alt="Genesis Logo"
                width={105}
                height={48}
                priority
                className="h-8 w-auto"
              />
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-semibold tracking-wide rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200/60 dark:border-slate-700">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
                v0.2 · Research
              </span>
            </div>
          </div>

          {/* Right Header Navigation & Actions */}
          <div className="flex items-center gap-3">
            <NotificationDropdown />

            {/* User Profile */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="User menu"
                  className="flex items-center gap-2 p-1 pl-1.5 pr-2.5 rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors shadow-2xs"
                >
                  <Avatar className="w-7 h-7">
                    <AvatarFallback className="bg-primary text-white font-bold text-xs">
                      {getUserInitials()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-xs font-semibold max-w-[100px] truncate text-slate-700 dark:text-slate-300">
                    {user?.firstName || 'Alex'}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 rounded-xl border-slate-200 dark:border-slate-800 shadow-lg">
                <DropdownMenuLabel>
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-semibold leading-none">{getUserDisplayName()}</p>
                    <p className="text-xs text-muted-foreground">{user?.email}</p>
                    <span className="inline-block mt-1 text-[10px] font-semibold text-primary uppercase">
                      {user?.organizationName || 'Genesis NLP Lab'}
                    </span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="cursor-pointer gap-2 text-xs">
                  <User className="w-4 h-4 text-slate-500" />
                  <span>Profile & Team</span>
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer gap-2 text-xs">
                  <Settings className="w-4 h-4 text-slate-500" />
                  <span>Workspace Preferences</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer gap-2 text-xs text-red-600 dark:text-red-400 focus:text-red-600"
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                >
                  <LogOut className="w-4 h-4" />
                  <span>{isLoggingOut ? 'Logging out...' : 'Log out'}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Main Workspace Area */}
      <main className="max-w-7xl mx-auto px-6 py-8 flex-1 w-full">
        {/* Hero Title & Primary CTAs */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                Annotation Workspace Suite
              </span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-4xl">
              Welcome back, {user?.firstName || 'Alex'}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-xl">
              Track entity labels, coreference clusters, syntax tags, and lexical senses across your research pipeline.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Button
              onClick={() => setIsNewWorkspaceOpen(true)}
              className="rounded-xl gap-2 font-semibold shadow-sm hover:shadow-md hover:shadow-primary/20 transition-all duration-200"
            >
              <Plus className="w-4 h-4" />
              <span>New Workspace</span>
            </Button>
          </div>
        </div>

        {/* Executive Quick-Pulse Metrics Strip */}
        <ExecutiveMetrics workspaces={workspaces} />

        {/* Control Bar: Filters, Search, View Mode */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pt-2">
          {/* Segmented Filter Pills */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-200/50 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 overflow-x-auto">
            {filterTabs.map((tab) => {
              const isSelected = selectedTab === tab;
              const count = tabCounts[tab];

              return (
                <button
                  key={tab}
                  onClick={() => setSelectedTab(tab)}
                  className={`relative flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors duration-150 ${
                    isSelected
                      ? 'text-slate-900 dark:text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {isSelected && (
                    <motion.div
                      layoutId="activeFilterPill"
                      className="absolute inset-0 rounded-lg bg-white dark:bg-slate-800 shadow-2xs border border-slate-200/60 dark:border-slate-700"
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    />
                  )}
                  <span className="relative z-10">
                    {tab === 'ALL' ? 'All Workspaces' : tab}
                  </span>
                  <span
                    className={`relative z-10 text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                      isSelected
                        ? 'bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white'
                        : 'bg-slate-200/70 dark:bg-slate-800 text-slate-500'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Search, Sort, and View Toggle Group */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Search Input with quick clear */}
            <div className="relative min-w-[220px] flex-1 sm:flex-initial">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <Input
                ref={searchInputRef}
                type="text"
                placeholder="Filter by name or tag..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-8 h-9 text-xs rounded-xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 focus-visible:ring-primary shadow-2xs"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Sort Selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-xl gap-1.5 text-xs border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs text-slate-700 dark:text-slate-300"
                >
                  <ArrowUpDown className="w-3.5 h-3.5 text-slate-500" />
                  <span className="hidden sm:inline">Sort:</span>
                  <span className="font-semibold">
                    {sortBy === 'recent'
                      ? 'Recently Active'
                      : sortBy === 'progress_desc'
                      ? 'Highest Progress'
                      : sortBy === 'progress_asc'
                      ? 'Lowest Progress'
                      : 'Alphabetical'}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44 rounded-xl">
                <DropdownMenuItem onClick={() => setSortBy('recent')} className="text-xs cursor-pointer">
                  Recently Active
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortBy('progress_desc')} className="text-xs cursor-pointer">
                  Highest Progress
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortBy('progress_asc')} className="text-xs cursor-pointer">
                  Lowest Progress
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortBy('alphabetical')} className="text-xs cursor-pointer">
                  Alphabetical
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* View Mode Toggle (Grid vs List) */}
            <div className="flex items-center p-0.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs">
              <button
                onClick={() => setViewMode('grid')}
                aria-label="Grid view"
                className={`p-1.5 rounded-lg transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-slate-100 dark:bg-slate-800 text-primary'
                    : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                }`}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                aria-label="List view"
                className={`p-1.5 rounded-lg transition-colors ${
                  viewMode === 'list'
                    ? 'bg-slate-100 dark:bg-slate-800 text-primary'
                    : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                }`}
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Content Display: Grid vs List with AnimatePresence */}
        {viewMode === 'grid' ? (
          <motion.div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            <AnimatePresence mode="popLayout">
              {filteredAndSortedWorkspaces.map((workspace) => (
                <WorkspaceCard key={workspace.id} workspace={workspace} />
              ))}
            </AnimatePresence>
          </motion.div>
        ) : (
          <motion.div layout className="space-y-3">
            <AnimatePresence mode="popLayout">
              {filteredAndSortedWorkspaces.map((workspace) => (
                <WorkspaceRow key={workspace.id} workspace={workspace} />
              ))}
            </AnimatePresence>
          </motion.div>
        )}

        {/* Clean, Deslopped Empty State */}
        {filteredAndSortedWorkspaces.length === 0 && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center text-center py-20 px-4 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-white/40 dark:bg-slate-900/40"
          >
            <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-4">
              <Search className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              No matching workspaces found
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
              {searchQuery
                ? `No workspaces matched "${searchQuery}". Try searching by another keyword or reset the search.`
                : `No workspaces found under the "${selectedTab}" annotation task.`}
            </p>
            <div className="flex gap-2.5 mt-5">
              {searchQuery && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSearchQuery('')}
                  className="rounded-xl text-xs"
                >
                  Clear search
                </Button>
              )}
              {selectedTab !== 'ALL' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedTab('ALL')}
                  className="rounded-xl text-xs"
                >
                  Show all tasks
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => setIsNewWorkspaceOpen(true)}
                className="rounded-xl text-xs gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Create workspace
              </Button>
            </div>
          </motion.div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200/60 dark:border-slate-800/80 py-6 px-6 mt-12 bg-white/50 dark:bg-slate-900/50">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-700 dark:text-slate-300">Genesis</span>
            <span>· Enterprise NLP Annotation & Curation Suite</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              All systems operational
            </span>
          </div>
        </div>
      </footer>

      {/* Interactive New Workspace Dialog */}
      <CreateWorkspaceDialog
        open={isNewWorkspaceOpen}
        onOpenChange={setIsNewWorkspaceOpen}
        onCreate={handleCreateWorkspace}
        isCreating={isCreating}
        createError={createError}
      />
    </div>
  );
}
