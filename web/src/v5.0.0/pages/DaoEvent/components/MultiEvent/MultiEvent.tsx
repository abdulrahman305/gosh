import { EDaoEventType } from '../../../../../types/common.types'
import { TDaoEventDetails } from '../../../../types/dao.types'
import { AddRegularTokensEvent } from '../AddRegularTokensEvent/AddRegularTokensEvent'
import { AddVotingTokensEvent } from '../AddVotingTokensEvent/AddVotingTokensEvent'
import { AllowDaoEventDiscussionEvent } from '../AllowDaoEventDiscussionEvent/AllowDaoEventDiscussionEvent'
import { AskDaoMembershipEvent } from '../AskDaoMembershipEvent/AskDaoMembershipEvent'
import { CreateDaoTagEvent } from '../CreateDaoTagEvent/CreateDaoTagEvent'
import { CreateTaskEvent } from '../CreateTaskEvent/CreateTaskEvent'
import { DeleteDaoTagEvent } from '../DeleteDaoTagEvent/DeleteDaoTagEvent'
import { DeleteTaskEvent } from '../DeleteTaskEvent/DeleteTaskEvent'
import { DisableMintTokensEvent } from '../DisableMintTokensEvent/DisableMintTokensEvent'
import { MemberAddEvent } from '../MemberAddEvent/MemberAddEvent'
import { MemberDeleteEvent } from '../MemberDeleteEvent/MemberDeleteEvent'
import { MemberUpdateEvent } from '../MemberUpdateEvent/MemberUpdateEvent'
import { MintTokensEvent } from '../MintTokensEvent/MintTokensEvent'
import { RedeployTaskCompleteEvent } from '../RedeployTaskCompleteEvent/RedeployTaskCompleteEvent'
import { RedeployTaskEvent } from '../RedeployTaskEvent/RedeployTaskEvent'
import { RepositoryCreateEvent } from '../RepositoryCreateEvent/RepositoryCreateEvent'
import { RepositoryDescriptionEvent } from '../RepositoryDescriptionEvent/RepositoryDescriptionEvent'
import { RepositoryTagAddEvent } from '../RepositoryTagAddEvent/RepositoryTagAddEvent'
import { RepositoryTagDeleteEvent } from '../RepositoryTagDeleteEvent/RepositoryTagDeleteEvent'
import { ShowDaoEventProgressEvent } from '../ShowDaoEventProgressEvent/ShowDaoEventProgressEvent'
import { UpgradeTaskEvent } from '../UpgradeTaskEvent/UpgradeTaskEvent'

type TMultiEventProps = {
  event: TDaoEventDetails
}

const MultiEvent = (props: TMultiEventProps) => {
  const { event } = props

  return (
    <div className="flex flex-col divide-y divide-gray-e6edff">
      {event.data.items
        .filter((data: any) => data.type !== EDaoEventType.DELAY)
        .map((item: any, index: number) => (
          <div className="py-3" key={index}>
            <h3 className="font-medium text-sm">{item.label}</h3>
            {item.data.comment && <div className="mt-2 text-xs">{item.data.comment}</div>}

            {item.type === EDaoEventType.REPO_CREATE && (
              <RepositoryCreateEvent
                key={index}
                data={item.data}
                isCompleted={event.status.completed}
              />
            )}
            {item.type === EDaoEventType.REPO_TAG_ADD && (
              <RepositoryTagAddEvent key={index} data={item.data} />
            )}
            {item.type === EDaoEventType.REPO_TAG_REMOVE && (
              <RepositoryTagDeleteEvent key={index} data={item.data} />
            )}
            {item.type === EDaoEventType.REPO_UPDATE_DESCRIPTION && (
              <RepositoryDescriptionEvent key={index} data={item.data} />
            )}
            {item.type === EDaoEventType.DAO_MEMBER_ADD && (
              <MemberAddEvent key={index} data={item.data} />
            )}
            {item.type === EDaoEventType.DAO_MEMBER_DELETE && (
              <MemberDeleteEvent key={index} data={item.data} />
            )}
            {item.type === EDaoEventType.DAO_TOKEN_MINT && (
              <MintTokensEvent key={index} data={item.data} />
            )}
            {item.type === EDaoEventType.DAO_TOKEN_VOTING_ADD && (
              <AddVotingTokensEvent key={index} data={item.data} />
            )}
            {item.type === EDaoEventType.DAO_TOKEN_REGULAR_ADD && (
              <AddRegularTokensEvent key={index} data={item.data} />
            )}
            {item.type === EDaoEventType.DAO_TAG_ADD && (
              <CreateDaoTagEvent key={index} data={item.data} />
            )}
            {item.type === EDaoEventType.DAO_TAG_REMOVE && (
              <DeleteDaoTagEvent key={index} data={item.data} />
            )}
            {item.type === EDaoEventType.DAO_EVENT_HIDE_PROGRESS && (
              <ShowDaoEventProgressEvent key={index} data={item.data} />
            )}
            {item.type === EDaoEventType.DAO_EVENT_ALLOW_DISCUSSION && (
              <AllowDaoEventDiscussionEvent key={index} data={item.data} />
            )}
            {item.type === EDaoEventType.DAO_ASK_MEMBERSHIP_ALLOWANCE && (
              <AskDaoMembershipEvent key={index} data={item.data} />
            )}
            {item.type === EDaoEventType.DAO_TOKEN_MINT_DISABLE && (
              <DisableMintTokensEvent key={index} data={item.data} />
            )}
            {item.type === EDaoEventType.DAO_ALLOWANCE_CHANGE && (
              <MemberUpdateEvent key={index} data={item.data} />
            )}
            {item.type === EDaoEventType.TASK_CREATE && (
              <CreateTaskEvent key={index} data={item.data} />
            )}
            {item.type === EDaoEventType.TASK_DELETE && (
              <DeleteTaskEvent key={index} data={item.data} />
            )}
            {item.type === EDaoEventType.TASK_UPGRADE && (
              <UpgradeTaskEvent key={index} data={item.data} />
            )}
            {item.type === EDaoEventType.TASK_REDEPLOY && (
              <RedeployTaskEvent key={index} data={item.data} />
            )}
            {item.type === EDaoEventType.TASK_REDEPLOYED && (
              <RedeployTaskCompleteEvent key={index} data={item.data} />
            )}
          </div>
        ))}
    </div>
  )
}

export { MultiEvent }
