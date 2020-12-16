const express = require("express");
const fs = require("fs");
const app = express();
const https = require("https");
//Node.js https from https://medium.com/@brunoeleodoro96/get-ssl-certificate-for-aws-ec2-nodejs-app-6ceed6486867
var options = {
    key: fs.readFileSync('./server-key.pem'),
    cert: fs.readFileSync('./server-cert.pem'),
};

var server = https.createServer(options, app).listen(3456, function(){
    console.log("Express server listening on port " + 3456);
});

const io = require("socket.io")(server);
var mysql = require("mysql");

srv = app.listen(process.env.PORT);
app.use('/peerjs', require('peer').ExpressPeerServer(srv, {
    debug: true,
}));

var clientsToSocketId = {};
var employeesToSocketId = {};
var globalMeetingId = 0;
var usersInRoom = [];

//Node.js + mySQL tutorial https://www.w3schools.com/nodejs/nodejs_mysql.asp
var con = mysql.createConnection({
    host: "localhost",
    user: "nodejsUser",
    password: "password",
    database: "videochat"
});

app.use("/style", express.static(__dirname + "/style"));
app.get("/", (req, res) => res.sendFile(__dirname + "/index.html"));

con.connect(function(err) {
    if(err) {
        console.error("Error connecting: " + err.stack);
        return;
    }
    console.log("Connected as id " + con.threadId);
});

io.on("connection", (socket) => {
    console.log("Connection established");
    socket.on("register_to_server", function(data) {
        var username = data["username"];
        var password = data["password"];
        var employee = data["employee"];

        var sql = "insert into users (username,password,employee) values ?";
        var values = [
            [username, password, employee]
        ];
        con.query(sql, [values], function (err,result) {
            if(err) {
                console.error("User insertion failed");
                io.to(socket.id).emit("register_to_client", {
                    success: false
                });
                return;
            }   
            //console.log("Number of rows affected: " + result.affectedRows)
            
            io.to(socket.id).emit("register_to_client", {
                success: true
            });
            console.log("Employees on server: " + JSON.stringify(employeesToSocketId));
        });
        
    });

    socket.on("login_to_server", function(data) {
        var username = data["username"];
        var password = data["password"];

        var sql = "SELECT password,employee FROM users WHERE username = ?";
        var values = [
            [username]
        ];
        con.query(sql, [values], function(err, result, fields) {
            if(err) {
                io.to(socket.id).emit("login_to_client", {
                    success: false,
                    message: "Grabbing password failed"
                });
                return;
            }
            if(result[0] == null) {
                io.to(socket.id).emit("login_to_client", {
                    success: false,
                    message: "User does not exist"
                });
                return;
            }

            var grabbedPassword = ""
            if(!(result == "")) {
                grabbedPassword = result[0].password;
            }
            //console.log("Grabbed password is: " + grabbedPassword);
            //console.log("Employee value is: " + result[0].employee);
            if(password == grabbedPassword) {
                var grabbedEmployee = result[0].employee;
                var employee = false;
                if(grabbedEmployee == 1) {
                    employee = true;
                    socket.employee = true;
                    employeesToSocketId[username] = socket.id;
                }
                else {
                    socket.employee = false;
                    clientsToSocketId[username] = socket.id;
                }
                io.to(socket.id).emit("login_to_client", {
                    success: true,
                    username: username,
                    employee: employee
                });
                return;
            }
            else {
                io.to(socket.id).emit("login_to_client", {
                    success: false,
                    message: "Password did not match"
                });
                return;
            }
        });
    });

    socket.on("logout_to_server", function(data) {
        if(data["employee"]){
            delete employeesToSocketId[data["username"]];
        }
        else {
            delete clientsToSocketId[data["username"]];
        }
    });

    socket.on("appointment_to_server", function(data) {
        console.log("Employee array looks like: " + JSON.stringify(employeesToSocketId));

        var username = data["username"];
        var startDate = data["startDate"];
        var endDate = data["endDate"];
        var duration = data["duration"];

        var sql = "INSERT INTO meetings (meeting_id, client, employee, startTime, endTime, accepted) VALUES ?";
        var values = [
            [globalMeetingId, username, "N/A", startDate, endDate, 0]
        ];
        con.query(sql, [values], function (err,result) {
            if(err) {
                console.error("Meeting insertion failed");
                io.to(socket.id).emit("appointment_to_client", {
                    success: false
                });
                return;
            }
            //console.log("Number of rows affected: " + result.affectedRows);
            globalMeetingId = globalMeetingId + 1;

            sql = "SELECT meeting_id FROM meetings WHERE client = ? AND startTime = ?;";

            con.query(sql, [username, startDate], function (err,result) {
                if(err) {
                    console.error("Grabbing meeting_id failed");
                    io.to(socket.id).emit("appointment_to_client", {
                        success: false
                    });
                    return;
                }
                var meetingId = result[0].meeting_id;
                //Iterating through dict code: https://stackoverflow.com/questions/9138959/parsing-json-dictionary-in-javascript-to-iterate-through-keys
                for(var key in employeesToSocketId) {
                    if(employeesToSocketId.hasOwnProperty(key)) {
                        console.log("Employee found and emitting");
                        io.to(employeesToSocketId[key]).emit("appointment_to_client", {
                            success: true,
                            client: username,
                            duration: duration,
                            startDate: startDate,
                            endDate: endDate,
                            meetingId: meetingId
                        });
                    }
                }
                    
                if(!socket.employee) {
                    io.to(socket.id).emit("appointment_to_client", {
                        success: true,
                        client: username,
                        duration: duration,
                        startDate: startDate,
                        endDate: endDate,
                        meetingId: meetingId
                    });
                }
            });
        });
    });

    socket.on("reject_to_server", function(data) {
        var meetingId = data["meetingId"];
        var sql = "SELECT client FROM meetings WHERE meeting_id = ?"
        con.query(sql, [meetingId], function (err,result) {
            if(err) {
                console.error("Grabbing username of meeting failed");
                io.to(socket.id).emit("reject_to_client", {
                    success: false
                });
                return;
            }
            con.query("DELETE FROM meetings WHERE meeting_id = ?", [meetingId], function (err) {
                if(err) {
                    console.error("Could not delete the meeting from the database");
                    io.to(socket.id).emit("reject_to_client", {
                        success: false
                    });
                    return;
                }
                var clientUsername = result[0].client;
                console.log("Meeting id received/sent is: " + meetingId);
                console.log("Username of this meeting is: " + clientUsername);
                var socketOfClient = clientsToSocketId[clientUsername];
                for(var key in employeesToSocketId) {
                    if(employeesToSocketId.hasOwnProperty(key)) {
                        io.to(employeesToSocketId[key]).emit("reject_to_client", {
                            success: true,
                            meetingId: meetingId
                        });
                    }
                }
                io.to(socketOfClient).emit("reject_to_client", {
                    success: true,
                    meetingId: meetingId
                });
            });
        });
    });

    socket.on("accept_to_server", function(data) {
        var meetingId = data["meetingId"];
        var employee = data["employee"];
        var sql = "UPDATE meetings SET accepted = ?, employee = ? WHERE meeting_id = ?"
        con.query(sql, [1, employee, meetingId], function (err) {
            if(err) {
                console.error("Updating meeting status failed");
                io.to(socket.id).emit("accept_to_client", {
                    success: false
                });
                return;
            }
            var sql2 = "SELECT client FROM meetings where meeting_id = ?"; 
            con.query(sql2, [meetingId], function (err,result) {
                if(err) {
                    console.error("Grabbing client name from meeting failed");
                    io.to(socket.id).emit("accept_to_client", {
                        success: false
                    });
                    return;
                }
                var clientName = result[0].client;
                var clientSocket = clientsToSocketId[clientName];
                io.to(clientSocket).emit("accept_to_client", {
                    success: true,
                    meetingId: meetingId,
                    receiver: "client"
                });

                for(var key in employeesToSocketId) {
                    if(employeesToSocketId.hasOwnProperty(key)) {
                        if(employeesToSocketId[key] == socket.id) {
                            io.to(employeesToSocketId[key]).emit("accept_to_client", {
                                success: true,
                                meetingId: meetingId,
                                receiver: "meetingEmployee"
                            });
                        }
                        else {
                            io.to(employeesToSocketId[key]).emit("accept_to_client", {
                                success: true,
                                meetingId: meetingId,
                                receiver: "otherEmployee"
                            });
                        }
                    }
                }
            });
        });
    });

    socket.on("open_meeting_to_server", function(data) {
        var username = data["username"];
        var meetingId = data["meetingId"]
        var sql = "SELECT client, employee, startTime, endTime FROM meetings where meeting_id = ?";
        con.query(sql, [meetingId], function (err, result) {
            if(err) {
                console.error("Updating meeting status failed");
                io.to(socket.id).emit("open_meeting_to_client", {
                    success: false
                });
                return;
            }
            var startTime = result[0].startTime;
            var endTime = result[0].endTime;
            var employee = result[0].employee;
            var client = result[0].client;
            console.log("Employee name is: " + employee);
            console.log("Client name is: " + client);
            var employeeSocket = employeesToSocketId[employee];
            var clientSocket = clientsToSocketId[client];

            var senderUsername = "";
            if(socket.id == clientSocket) {
                senderUsername = client;
            }
            else {
                senderUsername = employee;
            }

            var currentTime = new Date();
            if(currentTime < startTime) {
                console.log("Joining meeting early");
                io.to(socket.id).emit("open_meeting_to_client", {
                    success: true,
                    time: "early",
                    meetingId: meetingId,
                    sender: true
                });
            }
            if((currentTime >= startTime) && (currentTime <= endTime)) {
                usersInRoom.push(username);
                console.log("Joining meeting on-time");

                if(usersInRoom.length == 1) {
                    io.to(socket.id).emit("open_meeting_to_client", {
                        success: true,
                        time: "on-time",
                        meetingId: meetingId,
                        sender: true,
                        numInRoom: 1,
                        self: senderUsername
                    });
                }

                else if (usersInRoom.length == 2) {
                    if(clientSocket == socket.id) {
                        io.to(clientSocket).emit("open_meeting_to_client", {
                            success: true,
                            time: "on-time",
                            meetingId: meetingId,
                            sender: true,
                            other: employee,
                            numInRoom: 2,
                            self: senderUsername
                        });
                        io.to(employeeSocket).emit("open_meeting_to_client", {
                            success: true,
                            time: "on-time",
                            meetingId: meetingId,
                            sender: false,
                            other: client,
                            numInRoom: 2,
                            self: senderUsername
                        });
                    }
                    else {
                        io.to(clientSocket).emit("open_meeting_to_client", {
                            success: true,
                            time: "on-time",
                            meetingId: meetingId,
                            sender: false,
                            other: employee,
                            numInRoom: 2,
                            self: senderUsername
                        });
                        io.to(employeeSocket).emit("open_meeting_to_client", {
                            success: true,
                            time: "on-time",
                            meetingId: meetingId,
                            sender: true,
                            other: client,
                            numInRoom: 2,
                            self: senderUsername
                        });
                    }
                }
            }
            if(currentTime > endTime) {
                console.log("Joining meeting late");
                console.log("This socket: " + socket.id);
                console.log("Client socket: " + clientSocket);
                console.log("Employee socket: " + employeeSocket);
                if(clientSocket == socket.id) {
                    io.to(clientSocket).emit("open_meeting_to_client", {
                        success: true,
                        time: "late",
                        meetingId: meetingId,
                        sender: true,
                        other: employee
                    });
                    io.to(employeeSocket).emit("open_meeting_to_client", {
                        success: true,
                        time: "late",
                        meetingId: meetingId,
                        sender: false,
                        other: client
                    });
                }
                else {
                    io.to(clientSocket).emit("open_meeting_to_client", {
                        success: true,
                        time: "late",
                        meetingId: meetingId,
                        sender: false,
                        other: employee
                    });
                    io.to(employeeSocket).emit("open_meeting_to_client", {
                        success: true,
                        time: "late",
                        meetingId: meetingId,
                        sender: true,
                        other: client
                    });
                }
            }
        });
    });

    socket.on("join_room", function(data) {
        socket.join(data["meeting"]);
    });

    socket.on("leave_room", function(data) {
        console.log("Someone left room");
        var username = data["username"];
        var index = usersInRoom.indexOf(username);
        console.log(JSON.stringify(usersInRoom));
        usersInRoom.splice(index, 1);
        console.log(JSON.stringify(usersInRoom));
        socket.leave(data["meetingId"]);
        socket.broadcast.emit("user_left", {
            userToDel: username
        });
    });

    socket.on("message_to_server", function(data) {
        var message = data["message"];
        var sender = data["username"];
        io.to(data["meeting"]).emit("message_to_client", {
            sender: sender,
            message: message
        });
    });

});


//http.listen(3456, () => console.log("Listening on port 3456"));