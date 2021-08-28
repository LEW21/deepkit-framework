/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */

import { BrokerKernel } from '@deepkit/broker';
import { ClassType } from '@deepkit/core';
import { ConsoleTransport, Logger, MemoryLoggerTransport } from '@deepkit/logger';
import { Database, DatabaseRegistry, MemoryDatabaseAdapter } from '@deepkit/orm';
import { ClassSchema } from '@deepkit/type';
import { Application } from './application';
import { ApplicationServer } from './application-server';
import { Broker, BrokerServer, DirectBroker } from './broker/broker';
import { injectorReference } from '@deepkit/injector';
import { AppModule, RootModuleDefinition } from '@deepkit/app';
import { WebMemoryWorkerFactory, WebWorkerFactory } from './worker';
import { HttpKernel, HttpResponse, RequestBuilder } from '@deepkit/http';
import { RpcClient } from '@deepkit/rpc';

export class TestHttpResponse extends HttpResponse {
    public body: Buffer = Buffer.alloc(0);

    write(
        chunk: any,
        encoding: any,
        callback?: any
    ): boolean {
        if (typeof encoding === 'function') {
            callback = encoding;
            encoding = null;
        }

        if (chunk) {
            if ('string' === typeof chunk) {
                chunk = Buffer.from(chunk, encoding || 'utf8');
            }
            this.body = Buffer.concat([this.body, chunk]);
        }

        if (callback) callback();
        return true;
    }

    end(chunk: any, encoding?: any, callback?: any): void {
        if (typeof chunk === 'function') {
            callback = chunk;
            chunk = null;
            encoding = null;
        } else if (typeof encoding === 'function') {
            callback = encoding;
            encoding = null;
        }

        if (chunk) {
            if ('string' === typeof chunk) {
                chunk = Buffer.from(chunk, encoding || 'utf8');
            }
            this.body = Buffer.concat([this.body, chunk]);
        }
        if (callback) callback();
    }
}

export class TestingFacade<A extends Application<any>> {
    constructor(public app: A) {
    }

    public async startServer() {
        await this.app.get(ApplicationServer).start();
    }

    public async stopServer() {
        await this.app.get(ApplicationServer).close();
    }

    public async request(requestBuilder: RequestBuilder): Promise<TestHttpResponse> {
        const request = requestBuilder.build();
        const response = new TestHttpResponse(request);
        await this.app.get(HttpKernel).handleRequest(request, response);
        return response;
    }

    public createRpcClient(): RpcClient {
        return this.app.get(ApplicationServer).createClient();
    }
}

export class BrokerMemoryServer extends BrokerServer {
    public kernel = new BrokerKernel();

    async start() {
    }

    async stop() {
    }
}

/**
 * Creates a new Application instance, but with kernel services in place that work in memory.
 * For example RPC/Broker/HTTP communication without TCP stack. Logger uses MemoryLogger.
 */
export function createTestingApp<O extends RootModuleDefinition>(options: O, entities: (ClassType | ClassSchema)[] = [], setup?: (module: AppModule<any>) => void): TestingFacade<Application<O>> {
    const module = new AppModule(options);

    module.setupProvider(Logger).removeTransport(injectorReference(ConsoleTransport));
    module.setupProvider(Logger).addTransport(injectorReference(MemoryLoggerTransport));

    module.addProvider({ provide: WebWorkerFactory, useClass: WebMemoryWorkerFactory }); //don't start HTTP-server
    module.addProvider({ provide: BrokerServer, useClass: BrokerMemoryServer }); //don't start Broker TCP-server
    module.addProvider(MemoryLoggerTransport);
    module.addProvider({
        provide: Broker, deps: [BrokerServer], useFactory: (server: BrokerMemoryServer) => {
            return new DirectBroker(server.kernel);
        }
    });

    if (entities.length) {
        module.addProvider({ provide: Database, useValue: new Database(new MemoryDatabaseAdapter, entities) });
        module.setupGlobalProvider(DatabaseRegistry).addDatabase(Database, {}, module);
    }

    if (setup) module.setup(setup as any);

    return new TestingFacade(Application.fromModule(module));
}
