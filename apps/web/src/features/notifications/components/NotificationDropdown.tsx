'use client';

import React from 'react';
import { useNotifications } from '@/features/notifications/notifications.provider';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Bell, Trash } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useRouter } from 'next/navigation';

export function NotificationDropdown() {
    const { notifications, unreadCount, markAsRead, markAllAsRead, deleteNotification, refreshNotifications } =
        useNotifications();
    const router = useRouter();

    const handleNotificationClick = async (id: string, link?: string) => {
        await markAsRead(id);
        if (link) {
            router.push(link);
        }
    };

    return (
        <DropdownMenu onOpenChange={open => { if (open) refreshNotifications(); }}>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="relative group"
                    aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
                >
                    <Bell className="h-5 w-5 " aria-hidden="true" />
                    {unreadCount > 0 && (
                        <span
                            className="absolute -top-0 -right-0 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] text-white"
                            aria-live="polite"
                            aria-atomic="true"
                        >
                            {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                    )}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-80" align="end">
                <DropdownMenuLabel className="flex justify-between items-center">
                    <span>Notifications</span>
                    {unreadCount > 0 && (
                        <Button variant="ghost" size="sm" onClick={() => markAllAsRead()} className="text-xs h-auto py-1">
                            Mark all read
                        </Button>
                    )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <ScrollArea className="h-[20rem]">
                    {!notifications || notifications.length === 0 ? (
                        <div className="p-4 text-center text-sm text-gray-500">
                            No notifications
                        </div>
                    ) : (
                        <div className="flex flex-col">
                            {notifications.map((notification) => (
                                <div
                                    key={notification.id}
                                    className={`relative flex items-start gap-2 p-3 text-sm hover:bg-accent cursor-pointer border-b transition-colors ${!notification.read ? 'bg-blue-50/50 dark:bg-blue-900/20' : ''
                                        }`}
                                >
                                    <div
                                        className="flex-1 space-y-1"
                                        onClick={() => handleNotificationClick(notification.id, notification.link)}
                                    >
                                        <div className="flex items-center gap-2 font-medium">
                                            {notification.title}
                                            {!notification.read && (
                                                <span className="h-2 w-2 rounded-full bg-blue-600" />
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground line-clamp-2">
                                            {notification.message}
                                        </p>
                                        <p className="text-[10px] text-muted-foreground">
                                            {new Date(notification.createdAt).toLocaleString()}
                                        </p>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 shrink-0 opacity-50 hover:opacity-100"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            deleteNotification(notification.id);
                                        }}
                                    >
                                        <Trash className="h-3 w-3" />
                                        <span className="sr-only">Delete</span>
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </ScrollArea>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
