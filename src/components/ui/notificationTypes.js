import {
    Bell, MessageSquare, Ticket, Megaphone, FileText, UserCheck, MessageCircle,
    Hammer, CalendarClock, CalendarX
} from 'lucide-react';

// Gemeinsame Symbole und Farben je Benachrichtigungstyp (Glocke und Toast)
export const NOTIFICATION_ICONS = Object.freeze({
    message: MessageSquare,
    ticket: Ticket,
    ticket_comment: MessageCircle,
    announcement: Megaphone,
    document: FileText,
    registration: UserCheck,
    renovation_task_due: Hammer,
    renovation_project_due: Hammer,
    ok_event_due: CalendarClock,
    ok_event_overdue: CalendarX,
});

export const NOTIFICATION_COLORS = Object.freeze({
    message: '#3B82F6',
    ticket: '#F59E0B',
    ticket_comment: '#8B5CF6',
    announcement: '#10B981',
    document: '#6366F1',
    registration: '#22C55E',
    renovation_task_due: '#F97316',
    renovation_project_due: '#F97316',
    ok_event_due: '#0EA5E9',
    ok_event_overdue: '#EF4444',
});

const DEFAULT_ICON = Bell;
const DEFAULT_COLOR = '#6B7280';

export const getNotificationIcon = (type) => NOTIFICATION_ICONS[type] || DEFAULT_ICON;
export const getNotificationColor = (type) => NOTIFICATION_COLORS[type] || DEFAULT_COLOR;
