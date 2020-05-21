const fs = require('fs');
const fsp = fs.promises;

function DataSaver(path, filename, callbacks){
    this.path = path;
    this.filename = filename;
    this.status = {
        NOT_SPECIFIED: "NOT SPECIFIED",
        TRIGGER_PENDING: "TRIGGER PENDING",
        OPEN: "OPEN",
        OPEN_PENDING: "OPEN PENDING",
        VALIDATION_PENDING: "VALIDATION PENDING",
        PUT_ORDER_REQ_RECEIVED: "PUT ORDER REQ RECEIVED",
        STOPLOSS_TRIGGERED: "STOPLOSS TRIGGERED",
        TARGET_TRIGGERED: "TARGET TRIGGERED",
        AUTO_SQUARED_OFF: "AUTO SQUARED OFF"
    }
    this.header = "TIME,STRATEGY NAME,TRADE NO,STOCK,PRICE,QUANTITY,TYPE,SL,TARGET,STATUS,EXIT PRICE,PL";
    this.callbacks = callbacks;
}

function parseToFloat(n){
    if(n == 0 || n == null || n == undefined){
        return 0;
    }
    return parseFloat(parseFloat(n).toFixed(2));
}

(function(){
    var table = [];
    var tradeNo = 1;

    async function load(callbacks){
        this.callbacks = callbacks;
        if(!fs.existsSync(this.path + "/" + this.filename +".csv")){
            await this.dump();
        }
        var handle = await fsp.open(this.path + "/" + this.filename + '.csv', 'r+');
        var data = await handle.readFile({encoding: 'utf-8'});
        var lines = data.split('\n');
        for(var i=1; i < lines.length; i++){
            console.log(lines[i]);
            var line = lines[i];
            var [time, name, tn, stock, price, quantity, transactionType, triggerPrice, target, status, exitPrice, pl, msg_id] = line.split(',');
            time = new Date(this.filename + " " + time);
            tn = parseInt(tn);
            price = parseToFloat(price);
            triggerPrice = parseToFloat(triggerPrice);
            target = parseToFloat(target);
            pl = parseToFloat(pl);
            exitPrice = parseToFloat(exitPrice);
            tradeNo = tn;

            table.push({
                time, name, tradeNo:tn, stock, price, quantity, transactionType, triggerPrice, target, status, exitPrice, pl, msg_id
            })
        }
        handle && await handle.close();
        var self = this;
        setInterval(async function(){
            self.dump();
        }, 5000);
    }

    async function placeCO(stock, transactionType, quantity, triggerPrice, price, target, name){
        var order = {
            time: new Date().getTime(),
            tradeNo,
            stock,
            price,
            quantity,
            transactionType,
            triggerPrice,
            target,
            exitPrice: 0,
            pl: 0,
            name: name,
            status: this.status.TRIGGER_PENDING
        }
        table.push(order);
        tradeNo += 1;
        var msg_id = await this.callbacks.placed_order(order);
        order['msg_id'] = msg_id;
        return true;
    }

    async function deleteCO(stock, status){
        for(var i=0; i < table.length; i++){
            var order = table[i];
            if(order['stock'] == stock && this.isOpenStatus(order['status'])){
                order['status'] = status;
                order['exitPrice'] = ((status == this.status.TARGET_TRIGGERED)? order['target']: order['triggerPrice']);
                order['pl'] = getProfit(order);
                if(order['status'] == this.status.STOPLOSS_TRIGGERED){
                    await this.callbacks.closed_order(order, order['status']);
                }
                return true;
            }
        }
        return false;
    }

    async function closeTrades(dataFeed){
        this.callbacks.send('<b>Exit all trades to avoid square-off charges. Hope you are profitable</b>');
        for(var order of table){
            if(this.isOpenStatus(order['status'])){
                order['status'] = this.status.AUTO_SQUARED_OFF;
                order['exitPrice'] = await dataFeed.getLTP(order['stock']);
                order['pl'] = getProfit(order);
            }
        }
        await this.dump(true);
    }

    function getOpenStocks(name){
        return table.filter(order => this.isOpenStatus(order['status']) && order['name'] == name).map(order => order['stock']);
    }

    function getStockAndCounts(){
        var stockAndCounts = {};
        for(var order of table){
            if(stockAndCounts[order['stock']] == null){
                stockAndCounts[order['stock']] = 0;
            }
            stockAndCounts[order['stock']] += 1;
        }
        return stockAndCounts;
    }

    function getOpenOrder(stock){
        var orders = table.filter(order => this.isOpenStatus(order['status']) && order['stock'] == stock);
        if(orders.length > 0){
            return orders;
        }else{
            return null;
        }
    }

    function checkForStock(stock, price){
        var orders = this.getOpenOrder(stock) || [];
        for(var order of orders){
            var status = this.getStatus(order, price);
            if (status == this.status.TARGET_TRIGGERED) {
                this.deleteCO(stock, this.status.TARGET_TRIGGERED);
            } else if (status == this.status.STOPLOSS_TRIGGERED) {
                this.deleteCO(stock, this.status.STOPLOSS_TRIGGERED);
            } else {
                order['exitPrice'] = price;
                order['pl'] = getProfit(order);
            }
        }
    }

    function isOpenStatus(status){
        return ( status == this.status.TRIGGER_PENDING || 
        status == this.status.OPEN || 
        status == this.status.OPEN_PENDING || 
        status == this.status.VALIDATION_PENDING || 
        status == this.status.PUT_ORDER_REQ_RECEIVED );
    }

    async function dump(no_msg_id){
        var fileContent = this.header;
        for (var order of table) {
            fileContent = fileContent + "\n" + createLine(order, no_msg_id);
        }
        fs.writeFileSync(this.path + "/" + this.filename + '.csv', fileContent, {
            encoding: 'utf-8'
        });
    }

    function createLine(order, no_msg_id){
        let {
            time = null,
            name,
            tradeNo,
            stock = null,
            price = 0,
            quantity = 0,
            transactionType,
            triggerPrice = 0,
            target = 0,
            status = this.NOT_SPECIFIED,
            exitPrice = 0,
            pl = 0,
            msg_id
        } = order;
        price = fixed(price);
        transactionType = fixed(transactionType);
        triggerPrice = fixed(triggerPrice);
        target = fixed(target);
        exitPrice = fixed(exitPrice);
        pl = fixed(pl);
        var arr = [time && new Date(time).hhmmss() || 'INVALID', name, tradeNo, stock, price, quantity, transactionType, triggerPrice, target, status, exitPrice, pl, msg_id];
        if(no_msg_id){
            arr.pop();
        }
        return arr.join(',');
    }

    function getProfit(order){
        if(order['transactionType'].toLowerCase() == 'buy'){
            return (order['exitPrice'] - order['price']) * order['quantity'];
        }else{
            return (order['price'] - order['exitPrice']) * order['quantity'];
        }
    }

    function getStatus(order, price) {
        var {
            target,
            triggerPrice,
            transactionType: type
        } = order;
        if (target && ((type == 'buy' && price >= target) || (type == 'sell' && price <= target))) {
            return this.status.TARGET_TRIGGERED;
        }
        if (triggerPrice && ((type == 'buy' && price <= triggerPrice) || (type == 'sell' && price >= triggerPrice))) {
            return this.status.STOPLOSS_TRIGGERED;
        }
        return this.status.NOT_SPECIFIED;
    }

    function fixed(n){
        if(n == null || n == undefined || typeof n != 'number'){
            return n;
        }
        return n.toFixed(2);
    }

    DataSaver.prototype.load = load;
    DataSaver.prototype.dump = dump;
    DataSaver.prototype.placeCO = placeCO;
    DataSaver.prototype.deleteCO = deleteCO;
    DataSaver.prototype.isOpenStatus = isOpenStatus;
    DataSaver.prototype.getOpenStocks = getOpenStocks;
    DataSaver.prototype.getStockAndCounts = getStockAndCounts;
    DataSaver.prototype.getOpenOrder = getOpenOrder;
    DataSaver.prototype.closeTrades = closeTrades;
    DataSaver.prototype.getStatus = getStatus;
    DataSaver.prototype.checkForStock = checkForStock;
}());

module.exports = DataSaver;
//create a new file only todays date if it doesn't exists or open the already existing file
//save the order, time, their status, stock, price, triggerPrice and target
//a function is provided that when called will dump all the result into the csv which is opened, replacing the old contents with the new content
//tracking should be done in the file itself, hence it will be easy
//when an order is taken or modified it should be reflected within the file too, hence even when exited will track the orders