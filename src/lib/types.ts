export type Role = 'admin' | 'accounts' | 'ops' | 'client' | 'partner';

/** A brand we sell for, as their own portal reads it. */
export interface BrandPartner {
  brandId: string;
  brandName: string;
  /** They leave stock with us and are paid as it sells. */
  consignment: boolean;
  /** Whether their screens show what the goods sold for, not only what they are owed. */
  showsMargin: boolean;
}
export type OrderStatus = 'open' | 'complete' | 'cancelled';
export type InvoiceType =
  | 'full' | 'shipment' | 'backorder'
  /** Asks for nothing: shows what is coming and what it will cost. */
  | 'proforma'
  /** Money owed back to the client, never a debt waiting on them. */
  | 'credit';

/** Neither of these is ever waiting on a payment. */
export const isPayableType = (t: InvoiceType) => t !== 'proforma' && t !== 'credit';
export type RequestStatus = 'pending' | 'approved' | 'rejected';
export type TransferStatus = 'draft' | 'in_transit' | 'received' | 'cancelled';
export type XeroStatus = 'not_synced' | 'synced' | 'error';

export type OrderEventType =
  | 'placed' | 'invoice_sent' | 'payment_received'
  | 'supplier_ordered' | 'stock_arrived' | 'packed' | 'shipped' | 'delivered';

/**
 * One product as a client sees it: their own tier's price, and nothing about
 * stock beyond whether we can send it. Shaped by the client_catalogue view.
 */
export interface CatalogueItem {
  id: string; sku: string; name: string; brand: string | null;
  /** The range it belongs to — Dura-Ace, Ultegra — or null for most of a catalogue. */
  series: string | null;
  price: number; currency: string; in_stock: boolean; image_url: string | null;
  /**
   * The outer — the carton quantity, and so the least that buys `price`.
   *
   * One for most of a catalogue. Where it is more, `break_price` says what one
   * costs outside a full carton.
   */
  moq: number;
  /** What one costs below the outer, or null for one price at any quantity. */
  break_price: number | null;
  category_slug: string | null; category_name: string | null;
  /** Its collection is served by builders, so it is not offered on its own. */
  configurator_only: boolean;
  /** What this price does not include — duty, VAT — or null when it includes all of it. */
  price_note: string | null;
  /** Set when this product is one size of a bike; shared by every size of it. */
  variant_group: string | null;
  /** This product's size, as the customer picks it. */
  variant_label: string | null;
  variant_sort: number | null;
}

export interface Settings {
  id: number;
  company: string;
  company_address: string;
  invoice_prefix: string;
  next_invoice: number;
  next_order: number;
  next_po: number;
  next_transfer: number;
  vat_rate: number;
  payment_days: number;
  xero_account_code: string;
  tax_type_std: string;
  tax_type_zero: string;
  confirmation_cc: string[];
  supplier_recipient: string;
  application_recipients: string[];
  returns_recipients: string[];
  returns_days: number;
  email_from: string;
}

export interface Tier { id: string; name: string; sort: number }
export interface Location { id: string; name: string; address: string | null; active: boolean }
export interface Product {
  id: string; sku: string; name: string; brand: string | null; active: boolean;
  /** The money this product's cost and every tier price are quoted in. */
  currency: string;
  price_note: string | null;
  variant_group: string | null;
  variant_label: string | null;
  variant_sort: number | null;
}

export interface Client {
  id: string; name: string; tier_id: string; email: string | null; phone: string | null;
  vat_no: string | null; address: string | null; vat_exempt: boolean;
  default_location_id: string | null; auth_user_id: string | null; active: boolean;
}

export interface Order {
  id: string; number: string; client_id: string; date: string; status: OrderStatus;
  fulfilment_location_id: string; notes: string | null;
  /** Taken from the first line placed; every other line must agree. */
  currency: string;
}

export interface OrderLine {
  id: string; order_id: string; product_id: string | null; sku: string; name: string;
  qty: number; unit_price: number; alloc_qty: number; bo_qty: number; po_qty: number;
  invoiced_ship: boolean;
}

export interface Invoice {
  id: string; number: string; order_id: string; client_id: string; type: InvoiceType;
  date: string; due_date: string; vat_rate: number; paid: boolean; paid_date: string | null;
  ready_to_pack: boolean; packed: boolean; packed_at: string | null;
  shipped: boolean; shipped_at: string | null;
  delivered: boolean; delivered_at: string | null;
  carrier: string | null; tracking_number: string | null; tracking_url: string | null;
  location_id: string; superseded: boolean; currency: string;
  xero_id: string | null; xero_status: XeroStatus; xero_error: string | null; exported: boolean;
}

export interface InvoiceLine {
  id: string; invoice_id: string; sku: string; name: string; qty: number; unit_price: number;
}

export interface PurchaseOrder {
  id: string; number: string; date: string; received: boolean;
  received_at: string | null; receive_location_id: string;
}

export interface PoLine {
  id: string; po_id: string; sku: string; name: string; qty: number;
  so_reference: string | null; order_id: string | null; received_qty: number;
}

export interface OrderEvent {
  id: string; order_id: string; type: OrderEventType; created_at: string;
  meta: Record<string, unknown>;
}

export interface AccountRequest {
  id: string; company_name: string; trading_name: string | null;
  contact_name: string; email: string; phone: string | null;
  vat_no: string | null; company_number: string | null; eori_no: string | null;
  address: string | null; invoicing_address: string | null;
  business_type: string | null;
  website: string | null; social_media: string | null;
  message: string | null; status: RequestStatus;
  created_at: string; review_note: string | null; client_id: string | null;
}

/** Ordered stages of the client-facing timeline. */
export const TIMELINE: { type: OrderEventType; label: string }[] = [
  { type: 'placed', label: 'Placed' },
  { type: 'invoice_sent', label: 'Invoice sent' },
  { type: 'payment_received', label: 'Payment received' },
  { type: 'supplier_ordered', label: 'Ordered from supplier' },
  { type: 'stock_arrived', label: 'Stock arrived' },
  { type: 'packed', label: 'Packed' },
  { type: 'shipped', label: 'Shipped' },
  { type: 'delivered', label: 'Delivered' },
];

/** The only two reasons IQ accepts goods back. */
/**
 * A brand whose orders we introduce rather than sell.
 *
 * `terms` is the disclosure shown to the customer, one statement per line,
 * with {brand} and {company} filled in at the point of showing.
 */
export interface AgencyBrand { key: string; name: string; terms: string | null }

export type ReturnReason = 'faulty' | 'wrong_item';
export type ReturnStatus =
  'requested' | 'approved' | 'declined' | 'received' | 'resolved' | 'cancelled';
export type ReturnOutcome = 'refund' | 'exchange';

export const RETURN_REASONS: { key: ReturnReason; label: string; hint: string }[] = [
  { key: 'faulty', label: 'It arrived faulty',
    hint: 'Damaged in transit, or it failed in normal use.' },
  { key: 'wrong_item', label: 'We sent the wrong item',
    hint: 'What arrived is not what is on your order.' },
];

export const RETURN_STATUS_LABEL: Record<ReturnStatus, string> = {
  requested: 'With us to look at',
  approved: 'Approved — send it back',
  declined: 'Not accepted',
  received: 'Back with us',
  resolved: 'Settled',
  cancelled: 'Withdrawn',
};
