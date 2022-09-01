
const express = require('express');
const app = express();
const server = require('http').createServer(app);
var cors = require('cors');
const admin = require('firebase-admin');
const fs = require('fs');

// Google APIs config
const { google } = require('googleapis');
const TOKEN_PATH = './token_files/token.json';
const credentials = JSON.parse(fs.readFileSync('./token_files/client_secret_206495890686-h2cdd8su94aql14gbqqvbnvfgpllb8du.apps.googleusercontent.com.json'));
const { client_secret, client_id, redirect_uris } = credentials.installed;
const auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
const token = fs.readFileSync(TOKEN_PATH);
auth.setCredentials(JSON.parse(token))

// Firestore config
const serviceAccount = require('./secretario-do-senhor-bfc921599cd7.json');
const { getEventListener } = require('stream');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cors());

// FUNCTION -----

const getNextAta = async (dt) => {


    var new_reuniao = {
        dirigindo: "",
        pensamento: "",
        prim_oracao: "",
        ultim_oracao: ""
    }

    var participantes = {
        'Pres. Diogo': 0,
        'Pres. Tamanho': 0,
        'Pres. Martins': 0,
        'Rafael Bini': 0
    }

    const nao_pode_dirigir = [
        'Rafael Bini'
    ]

    var participantes_usados = [];

    const docs = (await db.collection('designacoes').get()).docs;
    var reunioes = docs.map(d => d.data());
    reunioes = reunioes.slice(reunioes.length - participantes.length, reunioes.length)

    var count = 0;
    for (let designacao in new_reuniao) {

        for (participante in participantes)
            participantes[participante] = 0;

        for (let reuniao of reunioes) {
            participantes[reuniao[designacao]] = ++count;
        }


        if (designacao == 'dirigindo')
            new_reuniao[designacao] = Object.entries(participantes).filter(p => !nao_pode_dirigir.includes(p[0]) && !participantes_usados.includes(p[0])).sort((a, b) => a[1] - b[1]).map(i => i[0])[0];
        else
            new_reuniao[designacao] = Object.entries(participantes).filter(p => !participantes_usados.includes(p[0])).sort((a, b) => a[1] - b[1]).map(i => i[0])[0];

        participantes_usados.push(new_reuniao[designacao]);

    }


    new_reuniao.dt = dt;
    new_reuniao.number = reunioes[reunioes.length - 1].number + 1
    return new_reuniao;
}

const getNextEvents = async (maxResults, dt) => {

    const calendar = google.calendar({ version: 'v3', auth });
    var events = [];
    var result = await calendar.events.list({
        calendarId: '6m58s6fvdoljeb33cjhholdga14ajom0@import.calendar.google.com',
        timeMin: (new Date(dt)).toISOString(),
        maxResults: maxResults,
        singleEvents: true,
        orderBy: 'startTime',
    })

    events = result.data.items.map(i => {
        return {
            summary: i.summary,
            description: i.description,
            startDate: i.start.dateTime ? new Date(i.start.dateTime).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : new Date(i.start.date).toLocaleString('pt-BR', { timeZone: 'UTC' })
        }
    })

    return events;
}

const getCoolDate = (dt) => {
    const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
        "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    var d = new Date(dt);
    //2021-05-01
    return `${d.toISOString().substr(8, 2)} ${monthNames[d.getMonth()]} ${d.getFullYear()}`
}

const getFullCoolDate = (dt) => {
    const monthNames = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
        "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
    var d = new Date(dt);
    //2021-05-01
    return `${d.toISOString().substr(8, 2)} de ${monthNames[d.getMonth()]} de ${d.getFullYear()}`
}

const getFormatedDatetime = function (dtString) {
    return `${dtString.substr(8, 2)}/${dtString.substr(5, 2)}/${dtString.substr(0, 4)} às ${dtString.substr(11, 5)}`
}

// ROUTES -------


// REUNIÃO PRESIDENCIA -----------

app.post('/new', async (req, res) => {

    if (!req.body.dt || req.body.dt.length != 10) {
        res.status(400).send({
            error: true,
            message: 'Please send dt in format yyyy-MM-dd'
        })
        return;
    }

    if ((new Date(req.body.dt).getTime() + (new Date().getUTCHours() * 1000 * 60 * 60)) < (new Date().getTime() - (1000 * 60 * 60))) {
        res.status(400).send({
            error: true,
            message: 'Cannot create a past meeting!'
        })
        return;
    }

    const new_reuniao = await getNextAta(req.body.dt);
    const events = await getNextEvents(7, req.body.dt);

    let requests = [
        {
            replaceAllText: {
                containsText: {
                    text: '{{MEETING_DATE}}',
                    matchCase: true,
                },
                replaceText: getCoolDate(req.body.dt),
            },
        },
        {
            replaceAllText: {
                containsText: {
                    text: '{{DIRIGINDO}}',
                    matchCase: true,
                },
                replaceText: new_reuniao.dirigindo,
            },
        },
        {
            replaceAllText: {
                containsText: {
                    text: '{{PRIM_ORACAO}}',
                    matchCase: true,
                },
                replaceText: new_reuniao.prim_oracao,
            },
        },
        {
            replaceAllText: {
                containsText: {
                    text: '{{PENSAMENTO}}',
                    matchCase: true,
                },
                replaceText: new_reuniao.pensamento,
            },
        },
        {
            replaceAllText: {
                containsText: {
                    text: '{{CALENDARIO}}',
                    matchCase: true,
                },
                replaceText: `\t\t- ${events.map(e => `${e.startDate.substr(0, 5)} ${e.startDate.substr(11, 5)} - ${e.summary}`).join('\n\t\t- ')}`,
            },
        },
        {
            replaceAllText: {
                containsText: {
                    text: '{{ULTIM_ORACAO}}',
                    matchCase: true,
                },
                replaceText: new_reuniao.ultim_oracao,
            },
        },
    ];

    const drive = google.drive({ version: 'v3', auth });
    var newDocumentId = "";
    drive.files.copy({
        fileId: '1R9dvGYnzDnChE96iIwORMWX0q8782IdWaBPvxZY7FAc',
        resource: {
            name: `${new_reuniao.number}. ${getCoolDate(req.body.dt)}`
        }
    }, (err, driveResponse) => {
        if (err) {
            console.log(`File Copy Fail: ${err}`);
            return;
        }
        newDocumentId = driveResponse.data.id;
        const docs = google.docs({ version: 'v1', auth });
        docs.documents.batchUpdate(
            {
                documentId: newDocumentId,
                resource: {
                    requests,
                },
            },
            (err) => {
                if (err) return console.log('BatchUpdate Fail: ' + err);
                console.log('Done!!')
                db.collection('designacoes').doc(`PRES_${req.body.dt.replace(/-/g, '_')}`).set(new_reuniao);
                res.send({
                    newDocumentId: newDocumentId,
                    docUrl: `https://docs.google.com/document/d/${newDocumentId}/edit`
                });
            });
    })


})

app.get('/reunioes', async (req, res) => {
    const docs = (await db.collection('designacoes').get()).docs;
    var reunioes = docs.map(d => d.data())
    res.send(reunioes);
})

app.get('/events/:startDate', async (req, res) => {
    res.send(await getNextEvents(7, req.params.startDate));
})

app.post('/create-event', async (req, res) => {
    const calendar = google.calendar({ version: 'v3', auth });
    var event = {
        'summary': req.body.summary,
        'location': req.body.location,
        'description': req.body.description,
        'start': {
            'dateTime': req.body.startDatetime,
            'timeZone': 'America/Sao_Paulo',
        },
        'end': {
            'dateTime': req.body.endDatetime,
            'timeZone': 'America/Sao_Paulo',
        },
        'recurrence': [],
        'attendees': [],
        'reminders': {
            'useDefault': false,
            'overrides': [],
        },
    };

    calendar.events.insert({
        auth: auth,
        calendarId: req.body.calendario,
        resource: event,
    }, function (err, event) {
        if (err) {
            console.log('There was an error contacting the Calendar service: ' + err);
            res.json({ msg: 'There was an error contacting the Calendar service: ' + err });
            return;
        }
        console.log('Event created: %s', event.htmlLink);
        res.json({ msg: "ok", link: event.htmlLink });
    });


})

// CONSELHO DE CONDIÇÃO DE MEMBRO

app.post('/conselho/ata', async (req, res) => {

    if (!req.body.dt) {
        res.status(400).send({
            error: true,
            message: 'Please send dt'
        })
        return;
    }

    if (!req.body.pessoa.nome || (req.body.pessoa.sexo != 'M' && req.body.pessoa.sexo != 'F')) {
        res.status(400).send({
            error: true,
            message: 'Please send nome and sexo'
        })
        return;
    }

    if ((new Date(req.body.dt).getTime() + (new Date().getUTCHours() * 1000 * 60 * 60)) < (new Date().getTime() - (1000 * 60 * 60))) {
        res.status(400).send({
            error: true,
            message: 'Cannot create a past meeting!'
        })
        return;
    }

    const participantes = ['Pres. Martins', 'Pres. Diogo'];
    const designacoes = {
        prim_oracao: 'NÃO DEFINIDO',
        dirigindo: 'NÃO DEFINIDO',
        ultim_oracao: 'NÃO DEFINIDO'
    }
    const RND_01 = Math.floor((Math.random() * 10) % 3)
    designacoes.prim_oracao = participantes.splice(RND_01, 1)[0];
    const RND_02 = Math.floor((Math.random() * 10) % 2)
    designacoes.ultim_oracao = participantes.splice(RND_02, 1)[0];
    designacoes.dirigindo = 'Pres. Tamanho';

    let requests = [
        {
            replaceAllText: {
                containsText: {
                    text: '{{DATA}}',
                    matchCase: true,
                },
                replaceText: getFormatedDatetime(req.body.dt),
            },
        },
        {
            replaceAllText: {
                containsText: {
                    text: '{{DIRIGINDO}}',
                    matchCase: true,
                },
                replaceText: designacoes.dirigindo,
            },
        },
        {
            replaceAllText: {
                containsText: {
                    text: '{{PRIM_ORACAO}}',
                    matchCase: true,
                },
                replaceText: designacoes.prim_oracao,
            },
        },
        {
            replaceAllText: {
                containsText: {
                    text: '{{NOME}}',
                    matchCase: true,
                },
                replaceText: req.body.pessoa.nome,
            },
        },
        {
            replaceAllText: {
                containsText: {
                    text: '{{ULTIM_ORACAO}}',
                    matchCase: true,
                },
                replaceText: designacoes.ultim_oracao,
            },
        },
    ];

    const drive = google.drive({ version: 'v3', auth });
    var newDocumentId = "";
    drive.files.copy({
        fileId: '10IymYi0QIutS0wlxMwlTAynTuHj_BWms2hCHRdqptt0',
        requestBody: {
            parents: ["1gMY0VGVsjH3XBdbl-vjXuP6MeBcSb6i2"],
            name: `_${req.body.pessoa.nome.substr(0, 3)}. Ata do Conselho de Condição de Membro`,
        }
    }, (err, driveResponse) => {
        if (err) {
            console.log(`File Copy Fail: ${err}`);
            return;
        }
        newDocumentId = driveResponse.data.id;
        const docs = google.docs({ version: 'v1', auth });
        docs.documents.batchUpdate(
            {
                documentId: newDocumentId,
                resource: {
                    requests,
                },
            },
            async (err) => {
                if (err) return console.log('BatchUpdate Fail: ' + err);
                res.send({
                    newDocumentId: newDocumentId,
                    docUrl: `https://docs.google.com/document/d/${newDocumentId}/edit`
                });
            });
    })


})

app.post('/conselho/notificacao', async (req, res) => {

    if (!req.body.dt) {
        res.status(400).send({
            error: true,
            message: 'Please send dt'
        })
        return;
    }

    if (!req.body.pessoa.nome || (req.body.pessoa.sexo != 'M' && req.body.pessoa.sexo != 'F')) {
        res.status(400).send({
            error: true,
            message: 'Please send nome and sexo'
        })
        return;
    }

    if ((new Date(req.body.dt).getTime() + (new Date().getUTCHours() * 1000 * 60 * 60)) < (new Date().getTime() - (1000 * 60 * 60))) {
        res.status(400).send({
            error: true,
            message: 'Cannot create a past meeting!'
        })
        return;
    }

    let requests = [
        {
            replaceAllText: {
                containsText: {
                    text: '{{DATA_HOJE}}',
                    matchCase: true,
                },
                replaceText: getFullCoolDate(new Date().toISOString().substr(0, 10)),
            },
        },
        {
            replaceAllText: {
                containsText: {
                    text: '{{O}}',
                    matchCase: true,
                },
                replaceText: req.body.pessoa.sexo == 'M' ? 'o' : 'a',
            },
        },
        {
            replaceAllText: {
                containsText: {
                    text: '{{IRMAO}}',
                    matchCase: true,
                },
                replaceText: req.body.pessoa.sexo == 'M' ? 'irmão' : 'irmã',
            },
        },
        {
            replaceAllText: {
                containsText: {
                    text: '{{DATA_CONSELHO}}',
                    matchCase: true,
                },
                replaceText: getFormatedDatetime(req.body.dt),
            },
        },
        {
            replaceAllText: {
                containsText: {
                    text: '{{NOME}}',
                    matchCase: true,
                },
                replaceText: req.body.pessoa.nome,
            },
        },
        {
            replaceAllText: {
                containsText: {
                    text: '{{CONVIDADO}}',
                    matchCase: true,
                },
                replaceText: req.body.pessoa.sexo == 'M' ? 'o presidente do quórum de élderes' : 'a presidente da Sociedade de Socorro da ala',
            },
        },
    ];

    const drive = google.drive({ version: 'v3', auth });
    var newDocumentId = "";
    drive.files.copy({
        fileId: '1H2sxmTlFRSmSSt459FpPYYBQoxVNZWpDT8Xv1ZkPfmY',
        resource: {
            name: `Notificacao_Temp`
        }
    }, (err, driveResponse) => {
        if (err) {
            console.log(`File Copy Fail: ${err}`);
            return;
        }
        newDocumentId = driveResponse.data.id;
        const docs = google.docs({ version: 'v1', auth });
        docs.documents.batchUpdate(
            {
                documentId: newDocumentId,
                resource: {
                    requests,
                },
            },
            async (err) => {
                if (err) return console.log('BatchUpdate Fail: ' + err);
                var response = await drive.files.export({
                    fileId: newDocumentId,
                    mimeType: 'application/pdf'
                }, { responseType: "arraybuffer" });

                fs.writeFile("local.pdf", Buffer.from(response.data), function (err) {
                    if (err) {
                        return console.log(err);
                    }
                    drive.files.delete({
                        fileId: newDocumentId
                    });

                    res.download("local.pdf");
                });


            });
    })


})

app.post('/conselho/remocao', async (req, res) => {

    if (!req.body.dt) {
        res.status(400).send({
            error: true,
            message: 'Please send dt'
        })
        return;
    }

    if (!req.body.pessoa.nome || (req.body.pessoa.sexo != 'M' && req.body.pessoa.sexo != 'F')) {
        res.status(400).send({
            error: true,
            message: 'Please send nome and sexo'
        })
        return;
    }

    if ((new Date(req.body.dt).getTime() + (new Date().getUTCHours() * 1000 * 60 * 60)) < (new Date().getTime() - (1000 * 60 * 60))) {
        res.status(400).send({
            error: true,
            message: 'Cannot create a past meeting!'
        })
        return;
    }

    let requests = [
        {
            replaceAllText: {
                containsText: {
                    text: '{{DATA_HOJE}}',
                    matchCase: true,
                },
                replaceText: getFullCoolDate(new Date().toISOString().substr(0, 10)),
            },
        },
        {
            replaceAllText: {
                containsText: {
                    text: '{{O}}',
                    matchCase: true,
                },
                replaceText: req.body.pessoa.sexo == 'M' ? 'o' : 'a',
            },
        },
        {
            replaceAllText: {
                containsText: {
                    text: '{{IRMAO}}',
                    matchCase: true,
                },
                replaceText: req.body.pessoa.sexo == 'M' ? 'irmão' : 'irmã',
            },
        },
        {
            replaceAllText: {
                containsText: {
                    text: '{{DATA_CONSELHO}}',
                    matchCase: true,
                },
                replaceText: getFormatedDatetime(req.body.dt),
            },
        },
        {
            replaceAllText: {
                containsText: {
                    text: '{{NOME}}',
                    matchCase: true,
                },
                replaceText: req.body.pessoa.nome,
            },
        }
    ];

    const drive = google.drive({ version: 'v3', auth });
    var newDocumentId = "";
    drive.files.copy({
        fileId: '1EWjjEHHhbPzu5GuzB9b9CaXgWdeSfz_F1Cz29GSeQmw',
        resource: {
            name: `Remocao_Temp`
        }
    }, (err, driveResponse) => {
        if (err) {
            console.log(`File Copy Fail: ${err}`);
            return;
        }
        newDocumentId = driveResponse.data.id;
        const docs = google.docs({ version: 'v1', auth });
        docs.documents.batchUpdate(
            {
                documentId: newDocumentId,
                resource: {
                    requests,
                },
            },
            async (err) => {
                if (err) return console.log('BatchUpdate Fail: ' + err);
                var response = await drive.files.export({
                    fileId: newDocumentId,
                    mimeType: 'application/pdf'
                }, { responseType: "arraybuffer" });

                fs.writeFile("local.pdf", Buffer.from(response.data), function (err) {
                    if (err) {
                        return console.log(err);
                    }
                    drive.files.delete({
                        fileId: newDocumentId
                    });

                    res.download("local.pdf");
                });


            });
    })


})

// LISTENER -----

server.listen(process.env.PORT || 2000);
console.log(`Listening port ${process.env.PORT || 2000}`);

