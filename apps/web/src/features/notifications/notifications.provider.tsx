'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { Client, IMessage } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import { Notification } from '@/features/notifications/notifications.contracts';
import { getAccessTokenAction } from '@/features/auth/auth.actions';
import {
  deleteNotificationAction,
  listNotificationsAction,
  markAllNotificationsAsReadAction,
  markNotificationAsReadAction,
} from '@/features/notifications/notifications.actions';
import { useAuth } from '@/features/auth/auth.provider';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface NotificationContextType {
    notifications: Notification[];
    unreadCount: number;
    showNotification: boolean;
    toggleNotifications: () => void;
    markAsRead: (id: string) => Promise<void>;
    markAllAsRead: () => Promise<void>;
    deleteNotification: (id: string) => Promise<void>;
    /** Re-read the list from the server (the panel calls this when it opens). */
    refreshNotifications: () => Promise<Notification[] | null>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
    const { user, isAuthenticated } = useAuth();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [stompClient, setStompClient] = useState<Client | null>(null);
    const [showNotification, setShowNotification] = useState(false);

    // Derived from the list so the badge can never drift from what is shown.
    const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications]);

    // The server is the source of truth: other tabs, devices or a long-open page
    // change notifications behind this one, so re-read instead of trusting local state.
    const refreshNotifications = useCallback(async (): Promise<Notification[] | null> => {
        if (!isAuthenticated) return null;
        const result = await listNotificationsAction();
        if (!result.ok) {
            console.error('Failed to fetch notifications', result.error);
            return null;
        }
        const data = result.data || [];
        setNotifications(data);
        return data;
    }, [isAuthenticated]);

    useEffect(() => {
        refreshNotifications();
        // Coming back to the tab picks up changes made elsewhere.
        const onFocus = () => {
            if (document.visibilityState === 'visible') refreshNotifications();
        };
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onFocus);
        return () => {
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onFocus);
        };
    }, [refreshNotifications]);

    // A failed per-item action usually means the item was already changed or
    // deleted elsewhere: resync, and only report it if the item is still there.
    const resyncAfterFailure = useCallback(
        async (id: string, message: string) => {
            const fresh = await refreshNotifications();
            if (fresh?.some(n => n.id === id)) toast.error(message);
        },
        [refreshNotifications],
    );

    // WebSocket Connection
    useEffect(() => {
        if (!isAuthenticated || !user) {
            if (stompClient) {
                stompClient.deactivate();
                setStompClient(null);
            }
            return;
        }

        let cancelled = false;
        let client: Client | null = null;

        // STOMP/SockJS can't read HttpOnly cookies, so we ask the server for
        // the access token via an action and pass it in connectHeaders.
        // The token stays in this closure; it's not persisted.
        (async () => {
            const tokenResult = await getAccessTokenAction();
            if (cancelled) return;
            if (!tokenResult.ok || !tokenResult.data) {
                console.warn('No access token for notification WebSocket', tokenResult.ok ? 'cookie missing' : tokenResult.error);
                return;
            }
            const accessToken = tokenResult.data;
            const socketUrl = `${API_BASE_URL}/ws`;

            client = new Client({
                webSocketFactory: () => new SockJS(socketUrl, undefined, { transports: ['xhr-polling'] }),
                connectHeaders: {
                    Authorization: `Bearer ${accessToken}`,
                },
                reconnectDelay: 5000,
                heartbeatIncoming: 4000,
                heartbeatOutgoing: 4000,

                onConnect: () => {
                    console.log('Connected to Notification WebSocket');

                    client?.subscribe(`/user/queue/notifications`, (message: IMessage) => {
                        try {
                            const notification: Notification = JSON.parse(message.body);
                            // Ignore a push for an item the list already has.
                            setNotifications(prev =>
                                prev.some(n => n.id === notification.id) ? prev : [notification, ...prev],
                            );
                        } catch (e) {
                            console.error('Failed to parse notification', e);
                        }
                    });
                },

                onStompError: (frame) => {
                    console.error('Broker reported error: ' + frame.headers['message']);
                    console.error('Additional details: ' + frame.body);
                },
            });

            client.activate();
            if (cancelled) {
                client.deactivate();
                return;
            }
            setStompClient(client);
        })();

        return () => {
            cancelled = true;
            client?.deactivate();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated, user]);

    const markAsRead = async (id: string) => {
        const result = await markNotificationAsReadAction(id);
        if (!result.ok) {
            await resyncAfterFailure(id, result.error || 'Could not mark the notification as read.');
            return;
        }
        setNotifications(prev => prev.map(n => (n.id === id ? { ...n, read: true } : n)));
    };

    const markAllAsRead = async () => {
        const result = await markAllNotificationsAsReadAction();
        if (!result.ok) {
            toast.error(result.error || 'Could not mark all notifications as read.');
            return;
        }
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
        // Also pick up anything that arrived or was removed elsewhere meanwhile.
        await refreshNotifications();
    };

    const deleteNotification = async (id: string) => {
        const result = await deleteNotificationAction(id);
        if (!result.ok) {
            await resyncAfterFailure(id, result.error || 'Could not delete the notification.');
            return;
        }
        setNotifications(prev => prev.filter(n => n.id !== id));
    };

    const toggleNotifications = () => {
        setShowNotification(prev => !prev);
    };

    return (
        <NotificationContext.Provider
            value={{
                notifications,
                unreadCount,
                showNotification,
                toggleNotifications,
                markAsRead,
                markAllAsRead,
                deleteNotification,
                refreshNotifications,
            }}
        >
            {children}
        </NotificationContext.Provider>
    );
}

export function useNotifications() {
    const context = useContext(NotificationContext);
    if (context === undefined) {
        throw new Error('useNotifications must be used within a NotificationProvider');
    }
    return context;
}
