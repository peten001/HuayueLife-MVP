import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentTerminal } from '../decorators/current-terminal.decorator';
import { TerminalHeartbeatDto } from '../dto/terminal-connector.dto';
import { TerminalHeartbeatAuthGuard } from '../guards/terminal-heartbeat-auth.guard';
import { TerminalConnectorService } from '../services/terminal-connector.service';
import { AuthenticatedTerminal } from '../types/terminal-auth';

@Controller('terminal')
@UseGuards(TerminalHeartbeatAuthGuard)
export class TerminalHeartbeatController {
  constructor(private readonly connector: TerminalConnectorService) {}

  @Post('heartbeat')
  heartbeat(
    @CurrentTerminal() terminal: AuthenticatedTerminal,
    @Body() dto: TerminalHeartbeatDto,
  ) {
    return this.connector.heartbeat(terminal, dto);
  }
}
