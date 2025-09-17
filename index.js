require('dotenv').config();
const { io } = require('socket.io-client');
const os = require('os');
const net = require('net');

// Check for required environment variable
if (!process.env.PROXY_SERVER) {
    console.error('\n❌ ERROR: PROXY_SERVER environment variable is not set!');
    console.error('📝 Please configure your .env file with:');
    console.error('   PROXY_SERVER=ws://your-master-proxy-server:3000\n');
    console.error('💡 Example:');
    console.error('   PROXY_SERVER=ws://proxy.example.com:3000');
    console.error('   PROXY_SERVER=wss://secure-proxy.example.com:3000\n');
    console.error('📚 Documentation: https://github.com/heysmmprovider/smm-panel-proxy-master');
    console.error('🛒 Get pre-configured servers at: https://heysmmreseller.com\n');
    
    // Keep the process alive to show the error message
    setInterval(() => {
        console.error('⚠️  Waiting for PROXY_SERVER configuration... Please set it in .env file');
    }, 30000);
    return;
}

const WSS_SERVER_URL = process.env.PROXY_SERVER;

const ProxyEvents = {
    CREATE_CONNECTION: "proxy:create-connection",
    CONNECTED: "proxy:connected",
    REQUEST: "proxy:request",
    CLIENT_DATA: "proxy:client-data",
    SERVER_DATA: "proxy:server-data",
    CONNECTION_ERROR: "proxy:connection-error",
    GET_SERVER_IP: "proxy:get-server-ip",
    LIST_MODEMS: "proxy:list-modems",
    RESET_MODEM: "proxy:reset-modem"
};

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('unhandledRejection', { reason, promise });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('uncaughtException', error, error.stack, error.message, error.name);
});

// Simple sleep helper function
const sleep = (seconds) => new Promise(resolve => setTimeout(resolve, seconds * 1000));

class IpV6ProxyConnector {
    constructor() {
        console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔌 IPv6 Proxy Connector Starting...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📡 Master Server: ${WSS_SERVER_URL}
🖥️  Server Name: ${os.hostname()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 HeySMMReseller.com - Premium SMM Services
💼 Need IPv6 Subnets? Visit https://heysmmreseller.com
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        `);

        this.socketsHashMap = new Map();
        this.ws = io(WSS_SERVER_URL, {
            transports: ['websocket'],
            extraHeaders: {
                'server-name': os.hostname(),
            },
            timeout: 5000,
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            randomizationFactor: 0.5
        });
        
        this.setupHeartbeat();
        this.initialize();
    }

    setupHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            if (this.ws.connected) {
                this.ws.emit('heartbeat', { time: Date.now() });
            }
        }, 30000); // Send heartbeat every 30 seconds

        this.ws.on('heartbeat_ack', (data) => {
            const latency = Date.now() - data.time;
            console.log(`💓 Heartbeat latency: ${latency}ms`);
        });
    }

    initialize() {
        this.wssInitialization();
    }

    wssInitialization() {
        this.ws.on('connect', async () => {
            console.log('✅ Successfully connected to master proxy:', WSS_SERVER_URL);
            console.log('📍 This connector is ready to route IPv6 traffic');
        });

        this.ws.on('disconnect', (reason) => {
            console.log('❌ Disconnected from master:', reason);
            if (reason === 'io server disconnect') {
                // The disconnection was initiated by the server, reconnect manually
                console.log('🔄 Attempting to reconnect to master...');
                this.ws.connect();
            }
            // Else the socket will automatically try to reconnect
        });

        this.ws.on('connect_error', (error) => {
            console.error('⚠️ Connection Error:', error.type);
            console.error('💡 Make sure the master proxy is running at:', WSS_SERVER_URL);
        });

        this.ws.on('reconnect_attempt', () => {
            console.log('🔄 Reconnection attempt to master proxy...');
        });

        this.ws.on('reconnect_failed', () => {
            console.error('❌ Reconnection failed - please check master proxy status');
        });

        this.ws.on('reconnect', (attemptNumber) => {
            console.log(`✅ Reconnected to master after ${attemptNumber} attempts`);
        });

        this.socketCreateConnectionEvent();
        this.socketDataEvent();
        this.proxyRequestEvent();
    }

    isValidIPv6Address(ipv6Address) {
        // Basic IPv6 validation - can be enhanced with subnet checking
        // For now returns true to allow all addresses from master
        return true;
    }

    async clearSocket({ correlationId }) {
        await sleep(4);
        if (this.socketsHashMap.has(correlationId)) {
            this.socketsHashMap.delete(correlationId);
        }
    }

    socketCreateConnectionEvent() {
        this.ws.on('error', (err) => {
            console.error('WebSocket error:', err);
        });

        this.ws.on(ProxyEvents.CREATE_CONNECTION, async (data) => {
            const { correlationId, port, host, ipv6Address } = data;
            
            if (!this.isValidIPv6Address(ipv6Address)) {
                this.ws.emit(ProxyEvents.CONNECTION_ERROR, { 
                    correlationId, 
                    error: 'Invalid IPv6 address' 
                });
                console.error('❌ Invalid IPv6 address:', ipv6Address);
                return;
            }

            try {
                const proxySocket = net.connect({
                    port,
                    host,
                    family: 6,
                    localAddress: ipv6Address,
                });

                this.ws.emit(ProxyEvents.CONNECTED, { correlationId });
                this.socketsHashMap.set(correlationId, proxySocket);

                proxySocket.on('data', (chunk) => {
                    this.ws.emit(ProxyEvents.SERVER_DATA, { correlationId, chunk });
                });

                proxySocket.on('end', () => {
                    proxySocket.end();
                });

                proxySocket.on('close', () => {
                    this.clearSocket({ correlationId });
                });

                proxySocket.on('error', (err) => {
                    console.error(`Connection error for ${ipv6Address}:`, err.message);
                    this.clearSocket({ correlationId });
                    this.ws.emit(ProxyEvents.CONNECTION_ERROR, { 
                        correlationId, 
                        error: err.message 
                    });
                });
            } catch (error) {
                console.error('Failed to create connection:', error);
                this.ws.emit(ProxyEvents.CONNECTION_ERROR, { 
                    correlationId, 
                    error: error.message 
                });
            }
        });
    }

    proxyRequestEvent() { // NON-SSL requests
        this.ws.on(ProxyEvents.REQUEST, async (props) => {
            const { correlationId, host, port, data, ipv6Address } = props;
            
            if (!props) {
                console.error('Received null props in proxy request');
                return;
            }

            try {
                const proxySocket = net.connect({
                    port,
                    host,
                    localAddress: ipv6Address,
                });

                proxySocket.on('connect', async () => {
                    if (data) {
                        const dataBuff = Buffer.from(data);
                        if (dataBuff) {
                            proxySocket.write(dataBuff);
                        } else {
                            this.ws?.emit(ProxyEvents.CONNECTION_ERROR, { 
                                correlationId, 
                                err: 'Invalid data buffer' 
                            });
                        }
                    }
                });

                this.socketsHashMap.set(correlationId, proxySocket);

                proxySocket.on('end', () => {
                    proxySocket.end();
                });

                proxySocket.on('close', () => {
                    this.clearSocket({ correlationId });
                });

                proxySocket.on('error', (err) => {
                    console.error(`Proxy request error for ${ipv6Address}:`, err.message);
                    this.clearSocket({ correlationId });
                    this.ws.emit(ProxyEvents.CONNECTION_ERROR, { 
                        correlationId, 
                        error: err.message 
                    });
                });

                proxySocket.on('data', (chunk) => {
                    this.ws.emit(ProxyEvents.SERVER_DATA, { correlationId, chunk });
                });
            } catch (error) {
                console.error('Failed to handle proxy request:', error);
                this.ws.emit(ProxyEvents.CONNECTION_ERROR, { 
                    correlationId, 
                    error: error.message 
                });
            }
        });
    }

    socketDataEvent() { // SSL traffic
        this.ws.on(ProxyEvents.CLIENT_DATA, ({ correlationId, chunk }) => {
            try {
                if (!this.socketsHashMap.has(correlationId)) {
                    console.error('No socket found for correlationId:', correlationId);
                    return;
                }

                if (!chunk) {
                    console.error('Received null data chunk for correlationId:', correlationId);
                    return;
                }

                const socket = this.socketsHashMap.get(correlationId);
                const dataBuff = Buffer.from(chunk);
                
                if (dataBuff) {
                    socket.write(dataBuff);
                } else {
                    this.ws.emit(ProxyEvents.CONNECTION_ERROR, {
                        correlationId,
                        err: 'Invalid data buffer',
                    });
                }
            } catch (error) {
                console.error('Error handling client data:', error);
            }
        });
    }
}

// Start the connector
new IpV6ProxyConnector();