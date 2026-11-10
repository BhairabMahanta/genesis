'use client';

import {
  ArrowLeft,
  BookOpen,
  FileText,
  Home,
  Settings as SettingsIcon,
  Tag,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WorkspaceResponse } from '@/features/workspace/workspace.contracts';

export type SidebarItem =
  | 'getting-started'
  | 'documents'
  | 'lexicon'
  | 'collaborators'
  | 'schema'
  | 'settings';

interface SidebarProps {
  workspace: WorkspaceResponse;
  activeSection: SidebarItem;
  isAdmin: boolean;
  onChangeSection: (section: SidebarItem) => void;
  onBack: () => void;
}

interface NavItem {
  id: SidebarItem;
  label: string;
  Icon: typeof Home;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'getting-started', label: 'Getting Started', Icon: Home },
  { id: 'documents', label: 'Documents', Icon: FileText },
  { id: 'collaborators', label: 'Collaborators', Icon: Users },
  { id: 'schema', label: 'Annotation Schema', Icon: Tag },
];

export function Sidebar({ workspace, activeSection, isAdmin, onChangeSection, onBack }: SidebarProps) {
  const navItems: NavItem[] =
    workspace.annotationType === 'WSD'
      ? [
          NAV_ITEMS[0],
          NAV_ITEMS[1],
          { id: 'lexicon', label: 'Sense Inventory', Icon: BookOpen },
          ...NAV_ITEMS.slice(2),
        ]
      : NAV_ITEMS;

  return (
    <aside className="w-64 border-r border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm min-h-[calc(100vh-73px)] sticky top-[73px]">
      <div className="p-4">
        <Button
          variant="ghost"
          className="w-full justify-start mb-6"
          onClick={onBack}
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="ml-2">Back to Home</span>
        </Button>

        <nav className="space-y-1">
          {navItems.map(({ id, label, Icon }) => (
            <SidebarButton
              key={id}
              active={activeSection === id}
              Icon={Icon}
              label={label}
              onClick={() => onChangeSection(id)}
            />
          ))}
          {isAdmin && (
            <SidebarButton
              active={activeSection === 'settings'}
              Icon={SettingsIcon}
              label="Settings"
              onClick={() => onChangeSection('settings')}
            />
          )}
        </nav>

        <div className="mt-8 p-4 bg-slate-100 dark:bg-slate-800 rounded-lg">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Progress</h3>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-600 dark:text-slate-400">Completion</span>
                <span className="font-bold text-[var(--primary)]">{workspace.progressPercentage}%</span>
              </div>
              <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[var(--primary)] to-purple-600 rounded-full"
                  style={{ width: `${workspace.progressPercentage}%` }}
                />
              </div>
            </div>
            <div className="text-xs text-slate-600 dark:text-slate-400">
              <p>{workspace.annotatedDocumentCount} / {workspace.documentCount} documents</p>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

interface SidebarButtonProps {
  active: boolean;
  Icon: typeof Home;
  label: string;
  onClick: () => void;
}

function SidebarButton({ active, Icon, label, onClick }: SidebarButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all ${
        active
          ? 'bg-[var(--primary)] text-white shadow-md'
          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
      }`}
    >
      <Icon className="w-5 h-5" />
      <span className="font-medium">{label}</span>
    </button>
  );
}
