const request = require('request');
const cheerio = require('cheerio');
const AsyncLock = require('async-lock');
var lock = new AsyncLock();

const LOGIN = "https://chartink.com/login";
const DASHBOARD = "https://chartink.com/scan_dashboard";
const SCAN = "https://chartink.com/screener/process";


var callback = null;
var interval = 0;

function ChartInk(email, password, strategies, c) {
    this.email = email;
    this.password = password;
    this.logics = (strategies && Array.isArray(strategies.logics) && strategies.logics) || [];
    this.entries = (strategies && Array.isArray(strategies.entries) && strategies.entries) || [];
    callback = c;
    var self = this;
    if(this.email == "NO_EMAIL"){
        this.scan_dashboard(""); //no user specified, use the cookie
        return;
    }
    request.get({
        url: LOGIN,
    }, (err, res, body) => {
        if (err) {
            console.log(err, "Error occurred");
        } else {
            cookie = res.headers['set-cookie'].map(cookie => cookie.split(';')[0]).join(';');
            let $ = cheerio.load(body);
            let token = $('input').val();
            self.login(token, cookie);
        }
    });
}

function init(){
    var self = this;
    request.get({
        url: LOGIN,
    }, (err, res, body) => {
        if(err){
            console.log(err, "Error occurred");
        } else {
            cookie = res.headers['set-cookie'].map(cookie => cookie.split(';')[0]).join(';');
            let $ = cheerio.load(body);
            let token = $('input').val();
            self.login(token, cookie);
        }
    })
}

function login(token, cookie) {
    var self = this;
    request.post({
        url: LOGIN,
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'cookie': cookie
        },
        form: {
            email: "gopalmadison@gmail.com",
            password: "catherine",
            remember: 'on',
            _token: token
        }
    },(err, res, body) => {
        cookie = res.headers['set-cookie'].map(cookie => cookie.split(';')[0]).join(';');
        self.scan_dashboard(cookie);
    })
}

function scan_dashboard(cookie) {
    var self = this;
    request.get({
        url: DASHBOARD,
        headers: {
            'cookie': cookie
        }
    }, (err, res, body) => {
        let cookie = res.headers['set-cookie'].map(cookie => cookie.split(';')[0]).join(';');
        let $ = cheerio.load(body);
        let csrf_token = $('meta[name="csrf-token"]').attr('content');
        self.start_pinging(cookie, csrf_token);
    })
}

function start_pinging(cookie, csrf_token) {
    var self = this;
    var logics_length = this.logics.length;
    let int = setInterval(async function () {
        for (var strategy of self.logics) {
            var logic = strategy['logic'];
            await sleep(700);
            request.post({
                url: SCAN,
                headers: {
                    'cookie': cookie,
                    'x-csrf-token': csrf_token
                },
                form: {
                    scan_clause: logic
                }
            }, function(s){
                return (err, res, body) => {
                    var stocks = [];
                    var data = [];
                    try {
                        data = JSON.parse(res.body).data;
                    } catch (e) {
                        self.stop_pinging();
                        self.init();
                        return;
                        //relogin to chartink from here
                    }
                    for (var trigger of data) {
                        stocks.push(trigger['nsecode']);
                    }
                    if (interval != -1) {
                        process.stdout.clearLine();
                        process.stdout.cursorTo(0);
                        process.stdout.write("Stocks in Radar: " + JSON.stringify(stocks) + "\r");
                    }
                    if (lock.isBusy()) {
                        return;
                    }
                    lock.acquire('key1', function(done){
                        var entries = self.findEntriesWithStrategyName(s['name']);
                        for(var entry of entries){
                            callback(
                                stocks,
                                entry['transactionType'], 
                                entry['name'], 
                                entry['frequency'],
                                entry['live'], 
                                entry['target'], 
                                entry['price'], 
                                entry['stoploss'], 
                                entry['userIds'], 
                                entry['beginOn'], 
                                entry['endOn'], 
                                done
                            ).catch(e => console.log(e));
                        }
                    }, function (err, ret) {}, {});
                }
            }(strategy));
        }
    }, 6000);
    interval = int;
}

function stop_pinging(){
    clearInterval(interval);
    interval = -1;
}

function findEntriesWithStrategyName(name){
    var entries = this.entries.filter(entry => entry['strategy'] == name);
    return entries;
}

async function sleep(ms){
    return new Promise(resolve => setTimeout(resolve, ms));
}

ChartInk.prototype.stop_pinging = stop_pinging;
ChartInk.prototype.start_pinging = start_pinging;
ChartInk.prototype.login = login;
ChartInk.prototype.scan_dashboard = scan_dashboard;
ChartInk.prototype.init = init;
ChartInk.prototype.findEntriesWithStrategyName = findEntriesWithStrategyName;

module.exports = ChartInk;