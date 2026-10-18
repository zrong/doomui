import { _decorator, Component, Button, Label } from 'cc';
const { ccclass, property } = _decorator;
@ccclass('ArticleDemoController')
export class ArticleDemoController extends Component {
  @property public claimedCount = 0;
  onLoad(): void {
    this.node.getChildByPath('root/$btn_claim')?.getComponent(Button)?.node.on(Button.EventType.CLICK, this.claim, this);
  }
  claim(): void {
    this.claimedCount += 1;
    const label = this.node.getChildByPath('root/$txt_reward')?.getComponent(Label);
    if (label) label.string = 'Claimed ' + this.claimedCount + ' time(s)';
  }
}
