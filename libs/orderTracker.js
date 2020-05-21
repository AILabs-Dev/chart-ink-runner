function OrderTracker(callbacks){
    this.orders = {};
    this.callbacks = callbacks;
    this.status = {
        TARGET_TRIGGERED: 1,
        STOPLOSS_TRIGGERED: -1,
        PENDING: 0
    }
}

//initially to load the pending orders from zerodha
function loadPendingOrders(orders, trader){
    for(var order of orders){
        if(order['tag'] == null) continue;
        var stock = order['tradingsymbol'];
        var order_id = order['order_id'];
        var orders_in_stock = this.orders[stock];
        if(orders_in_stock == null){
            orders_in_stock = {}
            this.orders[stock] = orders_in_stock;
        }
        orders_in_stock[order_id] = {order, trader};
    }
}

//creating the order according to zerodha order specifications
function createOrder(order_id, tradingsymbol, transaction_type, quantity, trigger_price, price, target){
    let order = {
        order_id,
        tradingsymbol,
        transaction_type,
        quantity,
        trigger_price,
        price,
        target
    }
    return order;
}

//track a particular order by adding it to the orders list
function trackOrder(stock, order, trader){
    var orders = this.orders[stock];
    if(orders == null){
        orders = {};
        this.orders[stock] = orders;
    }
    orders[order.order_id] = {order, trader};
}

//check if any of the orders for a particular stocks is hit or not
function checkForStock(stock, price){
    var orders = this.orders[stock] || {};
    for(var order_id in orders){
        var {order, trader} = orders[order_id];
        status = this.checkStatus(order, price);
        if(status == this.status.TARGET_TRIGGERED){
            var {variety, parent_order_id} = order;
            var params = {variety, order_id, parent_order_id};
            this.callbacks.targetTriggered(trader, params);
            this.deleteOrder(stock, order_id);
        }
        if(status == this.status.STOPLOSS_TRIGGERED){
            var {variety, parent_order_id} = order;
            var params = {variety, order_id, parent_order_id};
            this.callbacks.stoplossTriggered(trader, params);
            this.deleteOrder(stock, order_id);
        }
    }
}

//checking the status of the order, whether target or stoploss or nothing is hit
function checkStatus(order, price){
    var {
        trigger_price,
        transaction_type:type
    } = order;
    var target = order['target'] || order['tag'];
    if(target == null){
        return 0;
    }
    if (target && ((type == 'buy' && price >= target) || (type == 'sell' && price <= target))) {
        return this.status.TARGET_TRIGGERED;
    }
    if (trigger_price && ((type == 'buy' && price <= trigger_price) || (type == 'sell' && price >= trigger_price))) {
        return this.status.STOPLOSS_TRIGGERED;
    }
    return this.status.PENDING;
}

//deleting the order is mandatory, if any of target or stoploss is hit
function deleteOrder(stock, order_id){
    var orders = this.orders[stock];
    var order = orders[order_id];
    if(order != null){
        delete orders[order_id];
    }
}

//initializing the object
function initialize(callbacks){
    this.callbacks = callbacks;
}

OrderTracker.prototype.loadPendingOrders = loadPendingOrders;
OrderTracker.prototype.trackOrder = trackOrder;
OrderTracker.prototype.checkForStock = checkForStock;
OrderTracker.prototype.checkStatus = checkStatus;
OrderTracker.prototype.initialize = initialize;
OrderTracker.prototype.createOrder = createOrder;
OrderTracker.prototype.deleteOrder = deleteOrder;

module.exports = OrderTracker;