'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
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
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
    const { user, isAuthenticated } = useAuth();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [stompClient, setStompClient] = useState<Client | null>(null);
    const [showNotification, setShowNotification] = useState(false);

    // Fetch initial notifications
    const refreshNotifications = useCallback(async () => {
        if (!isAuthenticated) return;
        const result = await listNotificationsAction();
        if (!result.ok) {
            console.error('Failed to fetch notifications', result.error);
            return;
        }
        const data = result.data || [];
        setNotifications(data);
        setUnreadCount(data.filter(n => !n.read).length);
    }, [isAuthenticated]);

    useEffect(() => {
        refreshNotifications();
    }, [refreshNotifications]);

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
                            setNotifications(prev => [notification, ...prev]);
                            setUnreadCount(prev => prev + 1);
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
            console.error('Failed to mark notification as read', result.error);
            return;
        }
        setNotifications(prev => {
            const updated = prev.map(n => n.id === id ? { ...n, read: true } : n);
            setUnreadCount(updated.filter(n => !n.read).length);
            return updated;
        });
    };

    const markAllAsRead = async () => {
        const result = await markAllNotificationsAsReadAction();
        if (!result.ok) {
            console.error('Failed to mark all as read', result.error);
            return;
        }
        setNotifications(prev => {
            const updated = prev.map(n => ({ ...n, read: true }));
            setUnreadCount(0);
            return updated;
        });
    };

    const deleteNotification = async (id: string) => {
        const result = await deleteNotificationAction(id);
        if (!result.ok) {
            console.error('Failed to delete notification', result.error);
            return;
        }
        setNotifications(prev => {
            const updated = prev.filter(n => n.id !== id);
            setUnreadCount(updated.filter(n => !n.read).length);
            return updated;
        });
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
