const KiteTicker = require('./ticker');
var stocks_token = require('../res/stocks.json');
var stocks_to_tokens = {};
var tokens_to_stocks = {};
for (var d of stocks_token) {
    stocks_to_tokens[d['name']] = d['token'].toString();
    tokens_to_stocks[d['token'].toString()] = d['name'];
}

const DataFeed = (function(){
    function DataFeed(user_id, public_token, stocks){
        this.stocks = stocks;
        this.user_id = user_id;
        this.public_token = public_token || "wPXXjA5tJE8KJyWN753rbGnf5lXlzU0Q";
        this.api_key = "kitefront";
        this.user_agent = 'kite3-web';
        this.version = '2.4.0';
        var url = `wss://ws.zerodha.com/?api_key=${this.api_key}&user_id=${this.user_id}&public_token=${this.public_token}&user-agent=${this.user_agent}&version=${this.version}`;
        this.ticker = new KiteTicker({url});
        
        this.ticker.on('ticks', this.onticks.bind(this));
        this.ticker.on('connect', this.onconnect.bind(this));
        this.ticker.on('close', this.onclose.bind(this));

        this.ticker.connect();

        this.lastQuote = {} //last traded price of all the tokens registered
        this.addListener('ticks', (tick) => {
            this.lastQuote[tick['stock']] = tick;
        })
    }

    function subscribe(items){
        items = items.filter(item => (item != null));
        items = items.map(item => stocks_to_tokens[item] && parseInt(stocks_to_tokens[item]));
        this.ticker.subscribe(items);
        this.ticker.setMode(this.ticker.modeQuote, items);
    }

    function onticks(ticks){
        var handlers = this['ticks'] || [];
        for(var handler of handlers){
            for(var tick of ticks){
                var stock = tokens_to_stocks[tick['instrument_token'].toString()];
                tick['stock'] = stock;
                handler(tick);
            }
        }
    }

    function onconnect(){
        var handlers = this['connect'] || [];
        this.subscribe(this.stocks);
        for (var handler of handlers) {
            handler();
        }
    }

    function onclose(){
        var handlers = this['close'] || [];
        for (var handler of handlers) {
            handler();
        }
    }

    function addListener(name, handler) {
        var handlers = this[name];
        if (handlers == null) {
            handlers = [];
            this[name] = handlers;
        }
        handlers.push(handler);
    }

    function getLTP(stock){
        var lastQuote = this.lastQuote[stock] || {};
        return lastQuote['last_price'];
    }

    function getDaysHigh(stock){
        if(this.lastQuote[stock] == null){
            return null;
        }
        var lastQuote = this.lastQuote[stock] || {};
        return lastQuote['ohlc']['high'];
    }

    function getDaysLow(stock){
        if(this.lastQuote[stock] == null){
            return null;
        }
        var lastQuote = this.lastQuote[stock] || {};
        return lastQuote['ohlc']['low'];
    }

    DataFeed.prototype.subscribe = subscribe;
    DataFeed.prototype.onticks = onticks;
    DataFeed.prototype.onconnect = onconnect;
    DataFeed.prototype.onclose = onclose;
    DataFeed.prototype.addListener = addListener;
    DataFeed.prototype.getLTP = getLTP;
    DataFeed.prototype.getDaysHigh = getDaysHigh;
    DataFeed.prototype.getDaysLow = getDaysLow;
    return DataFeed;
}())

module.exports = DataFeed;