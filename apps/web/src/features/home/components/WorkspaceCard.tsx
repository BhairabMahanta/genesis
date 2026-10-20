'use client';

import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'motion/react';
import { WorkspaceResponse } from '@/features/workspace/workspace.contracts';
import { getTaskConfig } from '@/features/workspace/workspace.config';
import { formatDistanceToNow, isToday, isYesterday, isAfter, subDays, format } from 'date-fns';
import { ArrowRight, Clock, CheckCircle2, FileText } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { EASE_OUT, EASE_IN, EASE_SNAP } from '@/lib/motion';

interface WorkspaceCardProps {
  workspace: WorkspaceResponse;
}

export function WorkspaceCard({ workspace }: WorkspaceCardProps) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const config = getTaskConfig(workspace.annotationType);
  const Icon = config.icon;
  const isComplete = workspace.progressPercentage >= 100;

  const formatLastUpdated = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    if (isToday(date)) return formatDistanceToNow(date, { addSuffix: true });
    if (isYesterday(date)) return 'Yesterday';
    if (isAfter(date, subDays(now, 7))) return formatDistanceToNow(date, { addSuffix: true });
    return format(date, 'MMM d, yyyy');
  };

  const ownerInitials = workspace.ownerUsername
    .split(/[\s_.-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'U';

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, filter: 'blur(4px)' }}
      animate={{ opacity: 1, filter: 'blur(0px)', transition: { duration: 0.2, ease: EASE_OUT } }}
      exit={reduceMotion ? undefined : { opacity: 0, filter: 'blur(4px)', transition: { duration: 0.12, ease: EASE_IN } }}
      whileHover={reduceMotion ? {} : { y: -4, transition: { duration: 0.2, ease: EASE_SNAP } }}
      whileTap={{ scale: 0.98, transition: { duration: 0.1, ease: EASE_SNAP } }}
      onClick={() => router.push(`/workspace/${workspace.id}`)}
      className="group relative flex flex-col justify-between rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md p-6 cursor-pointer shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-[0_12px_28px_-6px_rgba(0,0,0,0.08)] hover:border-slate-300 dark:hover:border-slate-700 transition-all duration-200"
    >
      <div>
        {/* Top Header Row: Task Badge + Status */}
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center border shadow-xs transition-transform duration-200 group-hover:scale-105 ${config.theme.bg} ${config.theme.border}`}
            >
              <Icon className={`w-4.5 h-4.5 ${config.theme.text}`} />
            </div>
            <div>
              <span
                className={`text-[11px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-md border ${config.theme.bg} ${config.theme.border} ${config.theme.text}`}
              >
                {config.shortLabel}
              </span>
            </div>
          </div>

          {isComplete ? (
            <Badge
              variant="outline"
              className="text-[11px] font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 gap-1 py-0.5"
            >
              <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
              Complete
            </Badge>
          ) : (
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              Active
            </span>
          )}
        </div>

        {/* Title & Description */}
        <div className="mb-4">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white tracking-tight line-clamp-1 group-hover:text-primary transition-colors duration-150">
            {workspace.name}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-1.5 leading-relaxed min-h-[32px]">
            {workspace.description || config.description}
          </p>
        </div>

        {/* Sample Tag Preview Pills */}
        <div className="flex flex-wrap gap-1.5 mb-5">
          {config.sampleTokens.slice(0, 3).map((token) => (
            <span
              key={token}
              className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 border border-slate-200/50 dark:border-slate-700/50"
            >
              {token}
            </span>
          ))}
        </div>
      </div>

      {/* Progress & Bottom Metadata */}
      <div className="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800/80">
        <div>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="font-medium text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-slate-400" />
              {workspace.annotatedDocumentCount} / {workspace.documentCount} docs
            </span>
            <span className="font-semibold text-slate-900 dark:text-white tabular-nums">
              {workspace.progressPercentage}%
            </span>
          </div>

          <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <motion.div
              className={`h-full rounded-full bg-linear-to-r ${config.theme.progressGradient}`}
              initial={reduceMotion ? { width: `${workspace.progressPercentage}%` } : { width: 0 }}
              animate={{ width: `${workspace.progressPercentage}%` }}
              transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          {/* Owner */}
          <div className="flex items-center">
            <Avatar
              className="w-6 h-6 border-2 border-white dark:border-slate-900 text-[9px] font-bold"
              title={workspace.ownerUsername}
            >
              <AvatarFallback className="bg-indigo-600 text-white">
                {ownerInitials}
              </AvatarFallback>
            </Avatar>
            <span className="text-[11px] text-slate-400 pl-2.5 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatLastUpdated(workspace.updatedAt)}
            </span>
          </div>

          {/* Hover Action Link */}
          <div className="flex items-center gap-1 text-xs font-semibold text-primary opacity-80 group-hover:opacity-100 transition-opacity">
            <span>Open</span>
            <ArrowRight className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-1" />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
