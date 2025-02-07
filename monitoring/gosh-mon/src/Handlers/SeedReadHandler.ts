import AppHandler from "./AppHandler";
import {MetricsMap} from "../PrometheusFormatter";
import {ac_hrefs} from "../Utils";

export default class SeedReadHandler extends AppHandler {

    describe(): string {
        return `Seed read handler`;
    }

    async handle(debug: boolean): Promise<MetricsMap> {
        return await this.doSteps(
            /* 0 -  7 */ ...this.initialSteps(debug, AppHandler.userSteps),
            'click settings',    /* 8*/ () => this.click(`//a[${ac_hrefs('/a/settings')}]`),
            'wait show button',  /* 9*/ () => this.waitFor("//button[contains(., 'Show') and @type='button']"),
            'click show btn',    /*10*/ () => this.clickNow("//button[contains(., 'Show') and @type='button']", 1),
            'wait 100ms',               () => this.wait(100),
            'input pin code',           () => this.type("//input[@type='password' and @placeholder='PIN code']", "1111"),
            'wait 200ms',               () => this.wait(200),
            'click copy icon',   /*11*/ () => this.clickNow("svg.fa-copy", 4),
            'check seed',        /*12*/ () => { return this.checkSeed(); }
        );
    }

    protected async checkSeed(): Promise<number> {
        const obtainedSeed: string = await this.getClipboard();
        if (obtainedSeed === this.seed)
            return 0;
        else
            throw new Error('Returned value does not match expected');
    }

}