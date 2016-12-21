'use strict';

const builder = require('botbuilder');
const restify = require('restify');
const request = require('request');
const emoji = require('node-emoji');
const Zendesk = require('zendesk-node-api');
require('dotenv').config();

// Setup Restify Server
let server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, function () {
    console.log('%s listening to %s', server.name, server.url);
});

server.use(restify.queryParser());
server.use(restify.bodyParser());

// Create chat bot
let connector = new builder.ChatConnector({
    appId: process.env.MICROSOFT_APP_ID,
    appPassword: process.env.MICROSOFT_APP_PASSWORD
});
let bot = new builder.UniversalBot(connector);
bot.use(builder.Middleware.sendTyping());

let FileTicket = require('./fileTicket');
bot.dialog('/fileTicket', FileTicket.Dialog);

server.post('/api/messages', connector.listen());

var savedAddress;
server.get('/api/CustomWebApi', (req, res, next) => {
    sendProactiveMessage(savedAddress, req.query);
    next();
});

var zendesk = new Zendesk({
    url: process.env.ZENDESK_URL,
    email: process.env.ZENDESK_EMAIL,
    token: process.env.ZENDESK_API_KEY
});

function sendProactiveMessage(address, params) {
    var msg = new builder.Message().address(address);
    var txt = 'Your ticket #' + params.ticketId + ' is marked as ' + params.ticketStatus;
    if(params.ticketStatus == 'Solved') {
        txt += '\n\n Response from agent: ' + params.ticketComment;
    }
    msg.text(txt);
    bot.send(msg);
}

// Root dialog
bot.dialog('/', new builder.IntentDialog()
    .matchesAny([/ticket/i, /agent/i], [
        function (session) {
            session.beginDialog('/fileTicket');
        }
    ])
    .onDefault([
        function (session, args) {
             savedAddress = session.message.address;

            if(!session.userData.sessionId) {
                builder.Prompts.text(session, "Hi! Need assistance with your Microsoft product? Describe your problem and I'll look for the best solution.");
            } else {
                builder.Prompts.text(session, "Welcome back! Need assistance with your Microsoft product? Describe your problem and I'll look for the best solution");

                if(session.userData.tickets && session.userData.tickets.length > 0) {
                    var numOpenTickets = 0;
                    zendesk.tickets.showMany(session.userData.tickets).then(function(tickets) {
                        for(let i = 0; i < tickets.length; i++) {
                            if(tickets[i].status == "open" || tickets[i].status == "pending") {
                                numOpenTickets++;
                            } else {
                                let ticketId = parseInt(tickets[i].id);
                                let index = session.userData.tickets.indexOf(ticketId);
                                session.userData.tickets.splice(index, 1);
                            }
                        }
                    }).then(function(result) {
                        session.send("\n\n You have " + numOpenTickets + " open or pending ticket(s)");
                    });
                }
            }
        },
        function (session, result, next) {
            if(result.response) {
                request.post({url:'https://support.microsoft.com/api/search/virtualagent', 
                    form: {
                        "withDialog": true,
                        "augments": {
                            "TalkToHumanEnabled": true
                        },
                        "sessionId": "",
                        "page": 1,
                        "query": result.response
                    }
                }, function(err,res,body) {
                    let data = JSON.parse(body);
                    
                    if(data) {
                        session.userData.sessionId = data.sessionId;

                        if(data.content.webResults.items.length > 0) {
                            let items = data.content.webResults.items;

                            let message = new builder.Message()
                                .attachmentLayout(builder.AttachmentLayout.carousel)
                                .attachments(items.map(cardsAsAttachment));

                            session.send("Here are some suggestions...");
                            session.send(message);
                            next();
                        } else {
                            session.send("Could you try to rephrase the question? Using different words can sometimes help.");
                            session.replaceDialog("/" , { rephrase: true });
                        }
                    }
                });

                function cardsAsAttachment(item) {
                    return new builder.HeroCard()
                        .images([new builder.CardImage().url("http://image.thum.io/get/" + item.url)])
                        .title(item.title)
                        .text(item.description)
                        .buttons([
                            new builder.CardAction()
                                .title('Open')
                                .type('openUrl')
                                .value(item.url),
                        ]);
                }
            }
        },

        function(session) {
            builder.Prompts.choice(session, "Was this helpful?", [emoji.get('thumbsup'), emoji.get('thumbsdown')],{listStyle: builder.ListStyle["list"]});
        },
        function(session, result, next) {
            if(result.response) {
                switch(result.response.index) {
                    case 0:
                        session.send("Glad that was helpful! Your response is recorded!")
                        // TODO: record user response
                        break;
                    default:
                    case 1:
                        session.send("Sorry that wasn't helpful.");
                        builder.Prompts.choice(session, "Do you want to rephrase your question or file a ticket?", ['Rephrase', 'File Ticket'], {listStyle: builder.ListStyle["list"]});
                        break;
                }
            }
        },
        function(session, result, next) {
            switch(result.response.index) {
                case 0:
                default:
                    session.replaceDialog('/');
                    break;
                case 1:
                    session.beginDialog('/fileTicket');
                    break;
            }
        }
    ])
);