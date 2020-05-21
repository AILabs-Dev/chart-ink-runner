const request = require('request');

function Telegram(){}

function initialize(token, channel){
    this.token = token;
    this.channel = channel;
}

function send(msg, id){
    var self = this;
    return new Promise(function(resolve, reject){
        if (!self.token) return;
        var url = `https://api.telegram.org/bot${self.token}/sendMessage`;
        var data = {
            chat_id: `@${self.channel}`,
            text: msg,
            parse_mode: 'HTML'
        }
        if (id) {
            data['reply_to_message_id'] = parseInt(id);
        }
        let options = {
            uri: url,
            method: "POST",
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify(data)
        }
        request(options, function (err, response, body) {
            if(response){
                resolve(response);
            }else{
                reject(err);
            }
        })
    })
}

//callbacks
async function placed_order(order){
    var msg = `<b>Trade ${order['tradeNo']}</b>\n`;
    msg = msg + `${order['stock']}\n`;
    msg = msg + `<b>${(order['transactionType'].toLowerCase() == 'sell')? "Sell below": "Buy above"}</b> ${order['price'].toFixed(2)}\n`;
    msg = msg + `<b>Stop Loss </b>${order['triggerPrice'].toFixed(2)}`;

    var response = await this.send(msg, null);
    var result = JSON.parse(response['body']);
    if (result['ok']) {
        return result['result']['message_id'];
    }
    return null;
}

async function closed_order(order, status){
    var msg = `<b>${status}</b>`;
    await this.send(msg, order['msg_id']);
}

Telegram.prototype.initialize = initialize;
Telegram.prototype.send = send;
Telegram.prototype.placed_order = placed_order;
Telegram.prototype.closed_order = closed_order;

module.exports = Telegram;