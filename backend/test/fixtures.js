// Hand-built SQL-row-shaped input for buildMetrics()
export const business = { name: 'Test Bakery', category: 'bakery', currency: 'INR' };
export const rows = {
  totals: { cur_revenue: 1000, cur_gross_profit: 650, cur_orders: 100, prev_revenue: 1200, prev_gross_profit: 780, prev_orders: 110 },
  expenses: { cur: 500, prev: 500 },
  customers: { total: 20, repeat: 10, lapsed: 4 },
  products: [
    { product_id: 1, name: 'Cake', price: 40, cost: 18, stock: 12, low_stock_threshold: 10, active: true, cur_units: 10, cur_revenue: 400, cur_profit: 220, prev_units: 25, prev_revenue: 1000 },
    { product_id: 2, name: 'Bread', price: 6, cost: 2, stock: 20, low_stock_threshold: 10, active: true, cur_units: 120, cur_revenue: 720, cur_profit: 480, prev_units: 80, prev_revenue: 480 },
    { product_id: 3, name: 'Slice', price: 5, cost: 2, stock: 4, low_stock_threshold: 10, active: true, cur_units: 60, cur_revenue: 300, cur_profit: 180, prev_units: 62, prev_revenue: 310 },
    { product_id: 4, name: 'Old', price: 5, cost: 2, stock: 0, low_stock_threshold: 10, active: false, cur_units: 0, cur_revenue: 0, cur_profit: 0, prev_units: 40, prev_revenue: 200 },
  ],
};
