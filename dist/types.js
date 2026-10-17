// The one event shape every app sends to the collector. Shared with the
// collector and viewer, so keep it plain data.
/** Lane names the viewer knows how to order and label. Any other string
 *  still works; it just gets its own lane at the end. */
export const SERVICES = [
    "buyer",
    "agent",
    "touch_layer",
    "merchant_web",
    "merchant_api",
    "payment_api",
    "stripe",
];
//# sourceMappingURL=types.js.map