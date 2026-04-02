import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AivenKafkaService } from './kafka/aiven-kafka.service';

describe('AppController', () => {
  let appController: AppController;
  const kafkaService = {
    sendMessage: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: AivenKafkaService,
          useValue: kafkaService,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('sendKafkaMessage', () => {
    it('should send the payload to Kafka', async () => {
      kafkaService.sendMessage.mockResolvedValue(undefined);

      await expect(appController.sendKafkaMessage('hello')).resolves.toBe(
        'Kafka message queued: hello',
      );
      expect(kafkaService.sendMessage).toHaveBeenCalledWith('hello');
    });
  });
});
