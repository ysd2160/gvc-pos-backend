// Pure billing calculation (DB ke bina) - isliye aasani se test ho sakta hai.
// Yahin GST (shop ke hisaab se) aur cash-change ka hisaab hota hai.

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export class BillError extends Error {}

const MODES = ["Cash", "UPI", "Card"];

/**
 * lines:    [{ product, quantity }]   (product = Product doc)
 * discount: number
 * payments: undefined  -> poora Cash maan lo
 *           [] / list  -> jaisa diya waisa ([{mode, amount, received?}])
 * shop:     shop config ({ gstEnabled })
 */
export const computeBill = ({ lines, discount, payments, shop, channel = "Dine In" }) => {
  let subtotal = 0;
  let totalGst = 0;

  const items = lines.map(({ product, quantity, channelPrice }) => {
    let price = channelPrice;
    if (price == null) {
      price = typeof product.getPriceForChannel === "function"
        ? product.getPriceForChannel(channel)
        : (product.sellingPrice || 0);
    }
    price = round2(price);
    const lineTotal = round2(price * quantity);
    // GST sirf tab jab shop mein enabled ho (Frozetto). Cafe mein hamesha 0.
    const gstPercent = shop.gstEnabled ? product.gstPercent || 0 : 0;
    const gstAmount = round2((lineTotal * gstPercent) / 100);
    subtotal += lineTotal;
    totalGst += gstAmount;
    return {
      product: product._id,
      name: product.name,
      hsn: shop.gstEnabled ? product.hsn || "" : "",
      unit: product.unit,
      quantity,
      price,
      gstPercent,
      lineTotal,
      gstAmount,
    };
  });

  subtotal = round2(subtotal);
  totalGst = round2(totalGst);

  const discountAmount = round2(Math.max(0, Number(discount) || 0));
  if (discountAmount > round2(subtotal + totalGst)) {
    throw new BillError("Discount bill total se zyada nahi ho sakta");
  }
  const grandTotal = round2(subtotal + totalGst - discountAmount);

  // ---- Payments ----
  let list;
  if (payments === undefined || payments === null) {
    list = [{ mode: "Cash", amount: grandTotal, received: 0 }];
  } else {
    list = payments
      .map((p) => ({ mode: p.mode, amount: round2(Number(p.amount) || 0), received: round2(Number(p.received) || 0) }))
      .filter((p) => p.amount > 0);
  }

  let cashReceived = 0;
  let changeReturned = 0;

  const cleanPayments = list.map((p) => {
    if (!MODES.includes(p.mode)) throw new BillError(`Invalid payment mode: ${p.mode}`);
    if (p.mode === "Cash") {
      if (p.received > 0 && p.received + 0.001 < p.amount) {
        throw new BillError("Customer ne cash bill se kam diya hai");
      }
      // received nahi bhara to maan lo exact cash mila
      const given = p.received > 0 ? p.received : p.amount;
      cashReceived += given;
      changeReturned += given - p.amount;
    }
    // Reports mein sirf bill ke against lagi amount jaati hai (500 nahi, 230)
    return { mode: p.mode, amount: p.amount };
  });

  const amountPaid = round2(cleanPayments.reduce((s, p) => s + p.amount, 0));
  if (amountPaid > grandTotal + 0.01) {
    throw new BillError("Payment amount bill total se zyada hai");
  }
  const balanceDue = round2(Math.max(0, grandTotal - amountPaid));

  let paymentStatus = "Paid";
  if (balanceDue > 0) paymentStatus = amountPaid > 0 ? "Partial" : "Pending";

  return {
    items,
    subtotal,
    totalGst,
    discount: discountAmount,
    grandTotal,
    payments: cleanPayments,
    amountPaid,
    balanceDue,
    paymentStatus,
    cashReceived: round2(cashReceived),
    changeReturned: round2(changeReturned),
  };
};
