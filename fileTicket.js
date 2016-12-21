'use strict';

const builder = require('botbuilder');
const request = require('request');
const Zendesk = require('zendesk-node-api');
const emoji = require('node-emoji');

var zendesk = new Zendesk({
    url: process.env.ZENDESK_URL,
    email: process.env.ZENDESK_EMAIL,
    token: process.env.ZENDESK_API_KEY
});

module.exports = {
    Label: "File Ticket",
    Dialog: [
        function (session, args) {
            session.send("Gotcha! Filing a ticket...")
            builder.Prompts.text(session, "Let's start by getting a few keywords describing the issue")
        },
        function (session, results, next) {
            if(results.response) {
                session.dialogData.ticketSubject = results.response;
                builder.Prompts.text(session, "Ok, please describe the issue in more detail now please")
            }
        },
        function (session, results, next) {
            if(results.response) {
                session.dialogData.ticketBody = results.response;

                if(!session.userData.tickets) {
                    session.userData.tickets = [];
                }

                zendesk.tickets.create({
                    subject: session.dialogData.ticketSubject,
                    comment: {
                        body: session.dialogData.ticketBody
                    }
                }).then(function(result){
                    session.send("Ticket #" + result.ticket.id + " created, we'll keep in touch shortly!")

                    session.userData.tickets.push(result.ticket.id);
                });
                
                session.endDialog();
            }
        }
    ]
};



