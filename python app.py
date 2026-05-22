
import random
import time
import os

# Configurações do jogo
SIMBOLOS = ['🍒', '🍋', '🍊', '🍇', '⭐', '💎']
CHANCE_SIMBOLOS = [0.30, 0.25, 0.20, 0.13, 0.10, 0.02] # O Diamante (💎) é o mais raro!

MULTIPLICADORES = {
    '🍒': 2,
    '🍋': 3,
    '🍊': 5,
    '🍇': 8,
    '⭐': 15,
    '💎': 50  # Se tirar 3 diamantes, ganha 50x a aposta!
}

def limpar_tela():
    os.system('cls' if os.name == 'nt' else 'clear')

def girar_rolos():
    """Gira os 3 rolos baseando-se nas probabilidades de cada símbolo."""
    return random.choices(SIMBOLOS, weights=CHANCE_SIMBOLOS, k=3)

def exibir_rolos(rolos, animacao=False):
    """Exibe o visual dos rolos no terminal."""
    if animacao:
        for _ in range(3):
            for i in range(5):
                print(f"  [  {random.choice(SIMBOLOS)}  |  {random.choice(SIMBOLOS)}  |  {random.choice(SIMBOLOS)}  ]", end="\r")
                time.sleep(0.08)
    
    print(f"\n  🎰 [  {rolos[0]}  |  {rolos[1]}  |  {rolos[2]}  ] 🎰\n")

def calcular_ganho(rolos, aposta):
    """Verifica se o jogador ganhou e calcula o prêmio."""
    # Caso 1: Todos os 3 símbolos iguais
    if rolos[0] == rolos[1] == rolos[2]:
        simbolo = rolos[0]
        return aposta * MULTIPLICADORES[simbolo], f"JACKPOT! 3x {simbolo}!"
    
    # Caso 2: 2 símbolos iguais
    elif rolos[0] == rolos[1] or rolos[1] == rolos[2] or rolos[0] == rolos[2]:
        # Identifica qual símbolo repetiu
        simbolo = rolos[1] if rolos[1] == rolos[2] else rolos[0]
        # Dá um prêmio menor (metade do multiplicador padrão)
        ganho = int(aposta * (MULTIPLICADORES[simbolo] * 0.5))
        return max(ganho, aposta), f"Parabéns! 2x {simbolo}!"
    
    return 0, "Não foi dessa vez..."

def jogar():
    saldo = 100  # Saldo inicial do jogador
    
    while saldo > 0:
        limpar_tela()
        print("=" * 45)
        print("      ✨ BEM-VINDO AO PYTHON CASINO ✨      ")
        print("=" * 45)
        print(f" Seu Saldo Atual: ${saldo}")
        print("-" * 45)
        
        # Entrada da aposta
        entrada = input("Digite o valor da sua aposta (ou 'sair' para retirar o dinheiro): ").strip().lower()
        
        if entrada == 'sair':
            print(f"\n💰 Você saiu do cassino com ${saldo}. Volte sempre!")
            break
            
        if not entrada.isdigit():
            print("❌ Por favor, digite um número válido.")
            time.sleep(1.5)
            continue
            
        aposta = int(entrada)
        
        if aposta <= 0:
            print("❌ A aposta mínima é $1.")
            time.sleep(1.5)
            continue
            
        if aposta > saldo:
            print("❌ Saldo insuficiente para essa aposta!")
            time.sleep(1.5)
            continue
            
        # O jogo acontece aqui
        saldo -= aposta
        print("\nPuxando a alavanca...")
        
        rolos_sorteados = girar_rolos()
        exibir_rolos(rolos_sorteados, animacao=True)
        
        ganho, mensagem = calcular_ganho(rolos_sorteados, aposta)
        
        if ganho > 0:
            saldo += ganho
            print(f"🎉 {mensagem}")
            print(f"💰 Você ganhou: ${ganho}!")
        else:
            print(f"😢 {mensagem}")
            print(f"💸 Você perdeu: ${aposta}")
            
        if saldo == 0:
            print("\n❌ Você faliu! O cassino sempre ganha. 😉")
            break
            
        input("\nPressione ENTER para continuar...")

if __name__ == "__main__":
    jogar()
