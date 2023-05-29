export interface ReceiptItem {
    xLabel: string | null;
    itemId: string | null;
    name: string | null;
    price: string | null;
}

export interface Receipt {
    receiptId: string | null;
    receiptItems: ReceiptItem[];
    tradeDatetime: string | null;
}

export interface UserProfile {
    id: string;
    email: string;
    memberId?: string | null;
    fcmToken?: string;
    fcmTokenTimestamp?: number;
    notify?: boolean | null;
    timestamp?: number;
}
